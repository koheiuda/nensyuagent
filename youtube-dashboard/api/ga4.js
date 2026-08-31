// GA4 Data API v1beta。/nensyuagent/ 配下だけを対象にする。
// StockSun本体と同一プロパティのため、パス絞り込みは必須。
const { serviceAccountToken, authedFetch } = require('./_google.js');

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const BASE = 'https://analyticsdata.googleapis.com/v1beta';
const PATH_PREFIX = '/nensyuagent/';

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=1800, stale-while-revalidate=3600' : 'no-store');
  res.end(JSON.stringify(body));
}

function pathFilter() {
  return {
    filter: { fieldName: 'pagePath', stringFilter: { matchType: 'BEGINS_WITH', value: PATH_PREFIX } },
  };
}

function andFilter(filters) {
  return { andGroup: { expressions: filters } };
}

function youtubeFilter() {
  return {
    filter: { fieldName: 'sessionSource', stringFilter: { matchType: 'CONTAINS', value: 'youtube', caseSensitive: false } },
  };
}

async function runReport(propertyId, token, body) {
  return authedFetch(`${BASE}/properties/${propertyId}:runReport`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// GA4 は「コンバージョン」の指標名を keyEvents に変更した。どちらが通るか環境で違うため両方試す。
async function runWithKeyEvents(propertyId, token, base) {
  for (const name of ['keyEvents', 'conversions']) {
    try {
      const body = JSON.parse(JSON.stringify(base));
      body.metrics = body.metrics.concat([{ name }]);
      const r = await runReport(propertyId, token, body);
      return { report: r, conversionMetric: name };
    } catch (e) {
      if (!/keyEvents|conversions|did not match|Field/i.test(e.message || '')) throw e;
    }
  }
  // どちらも通らなければCV抜きで返す
  return { report: await runReport(propertyId, token, base), conversionMetric: null };
}

/** runReport のレスポンスを [{dim1, metric1, ...}] の配列に均す。 */
function toRows(report) {
  const dimHeaders = (report.dimensionHeaders || []).map(function (h) { return h.name; });
  const metHeaders = (report.metricHeaders || []).map(function (h) { return h.name; });
  return (report.rows || []).map(function (r) {
    const out = {};
    dimHeaders.forEach(function (n, i) { out[n] = ((r.dimensionValues || [])[i] || {}).value || ''; });
    metHeaders.forEach(function (n, i) { out[n] = Number(((r.metricValues || [])[i] || {}).value || 0); });
    return out;
  });
}

module.exports = async (req, res) => {
  const propertyId = process.env.GA4_PROPERTY_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 90, 1), 400);
  const startDate = `${days}daysAgo`;

  if (!propertyId || !saJson) {
    return send(res, 503, {
      error: 'not_configured',
      message: '環境変数 GA4_PROPERTY_ID と GOOGLE_SERVICE_ACCOUNT_JSON を設定してください。' +
               'サービスアカウントには対象プロパティの「閲覧者」権限が必要です。',
      needs: ['GA4_PROPERTY_ID', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
    });
  }

  try {
    const token = await serviceAccountToken(saJson, SCOPE);
    const dateRanges = [{ startDate, endDate: 'today' }];
    const baseMetrics = [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }];

    // 1) 日別の推移
    const daily = await runWithKeyEvents(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: baseMetrics,
      dimensionFilter: pathFilter(),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    });

    // 2) 参照元／メディア別
    const bySource = await runReport(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'sessionSourceMedium' }],
      metrics: baseMetrics,
      dimensionFilter: pathFilter(),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
      limit: 25,
    });

    // 3) ページ別
    const byPage = await runReport(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'pagePath' }],
      metrics: baseMetrics,
      dimensionFilter: pathFilter(),
      orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }],
      limit: 50,
    });

    // 4) YouTube経由だけを分離（送客の評価はここで行う）
    const youtube = await runReport(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: baseMetrics,
      dimensionFilter: andFilter([pathFilter(), youtubeFilter()]),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    });

    return send(res, 200, {
      fetchedAt: new Date().toISOString(),
      propertyId,
      pathPrefix: PATH_PREFIX,
      days,
      conversionMetric: daily.conversionMetric,
      daily: toRows(daily.report),
      bySourceMedium: toRows(bySource),
      byPage: toRows(byPage),
      youtubeDaily: toRows(youtube),
    });
  } catch (e) {
    const status = e.status === 403 ? 403 : e.status === 401 ? 401 : 502;
    return send(res, status, {
      error: 'ga4_api_error',
      message: e.message || 'GA4 API の呼び出しに失敗しました。',
      hint: status === 403
        ? 'サービスアカウントのメールアドレスを、GA4プロパティの「閲覧者」に追加してください。'
        : undefined,
    });
  }
};

module.exports.toRows = toRows;
module.exports.PATH_PREFIX = PATH_PREFIX;
