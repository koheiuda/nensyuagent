// Google Search Console API v3。
//
// 本チャンネルの主目的は「指名検索の創出」（docs/YouTube_運用設計.md 第1章）。
// その達成度を測れるのはここだけなので、指名クエリの推移を最重要指標として扱う。
//
// 認証は GA4 と同じサービスアカウントを使える。ただし Search Console 側でも
// そのサービスアカウントを「ユーザーとして追加」する必要がある（GA4とは別の設定）。
const { serviceAccountToken, authedFetch } = require('./_google.js');
const { requireAuth } = require('./_auth.js');

const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const BASE = 'https://searchconsole.googleapis.com/webmasters/v3/sites';
const PATH_PREFIX = '/nensyuagent/';
const DEFAULT_BRAND = '年収エージェント';
// GSC のデータは2〜3日遅れて確定する
const LAG_DAYS = 3;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=3600, stale-while-revalidate=7200' : 'no-store');
  res.end(JSON.stringify(body));
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

function contains(dimension, expression) {
  return { dimension, operator: 'contains', expression };
}

async function query(siteUrl, token, body) {
  const url = `${BASE}/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  return authedFetch(url, token, { method: 'POST', body: JSON.stringify(body) });
}

/** GSC の rows（keys配列＋指標）を、次元名をキーにしたオブジェクト配列へ均す。 */
function toRows(payload, dimensions) {
  return (payload.rows || []).map(function (r) {
    const o = {};
    dimensions.forEach(function (d, i) { o[d] = (r.keys || [])[i]; });
    o.clicks = r.clicks || 0;
    o.impressions = r.impressions || 0;
    o.ctr = (r.ctr || 0) * 100;   // GSCは0〜1で返すのでパーセントに直す
    o.position = r.position || 0;
    return o;
  });
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;

  const siteUrl = process.env.GSC_SITE_URL;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const brand = process.env.GSC_BRAND_QUERY || DEFAULT_BRAND;
  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 90, 1), 480);

  if (!siteUrl || !saJson) {
    return send(res, 503, {
      error: 'not_configured',
      message: '環境変数 GSC_SITE_URL と GOOGLE_SERVICE_ACCOUNT_JSON を設定してください。' +
               'Search Console 側でもサービスアカウントをユーザーとして追加する必要があります。',
      needs: ['GSC_SITE_URL', 'GOOGLE_SERVICE_ACCOUNT_JSON'],
    });
  }

  const endDate = isoDaysAgo(LAG_DAYS);
  const startDate = isoDaysAgo(days + LAG_DAYS);
  const range = { startDate, endDate };

  try {
    const token = await serviceAccountToken(saJson, SCOPE);
    const out = { fetchedAt: new Date().toISOString(), siteUrl, brand, pathPrefix: PATH_PREFIX,
                  startDate, endDate, days, lagDays: LAG_DAYS, failed: {} };

    const jobs = [
      // 主KPI：指名クエリの推移
      ['brandDaily', ['date'], {
        dimensionFilterGroups: [{ filters: [contains('query', brand)] }], rowLimit: 500,
      }],
      // 指名クエリの内訳（どんな掛け合わせで検索されているか）
      ['brandQueries', ['query'], {
        dimensionFilterGroups: [{ filters: [contains('query', brand)] }], rowLimit: 100,
      }],
      // エージェント個人ページに来ているクエリ＝人名指名検索。B の打ち手の実効性を測る
      ['agentQueries', ['query'], {
        dimensionFilterGroups: [{ filters: [contains('page', PATH_PREFIX + 'agent/')] }], rowLimit: 100,
      }],
      // /nensyuagent/ 配下のページ別
      ['pages', ['page'], {
        dimensionFilterGroups: [{ filters: [contains('page', PATH_PREFIX)] }], rowLimit: 100,
      }],
    ];

    for (const [name, dimensions, extra] of jobs) {
      try {
        const payload = await query(siteUrl, token, Object.assign({}, range, { dimensions }, extra));
        out[name] = toRows(payload, dimensions);
      } catch (e) {
        out.failed[name] = e.message || 'unknown error';
        out[name] = [];
      }
    }

    if (Object.keys(out.failed).length === jobs.length) {
      // 全滅する原因はほぼ「サービスアカウントをSearch Consoleに追加していない」か
      // 「GSC_SITE_URL の形式違い」。それが分かるように返す。
      const messages = Object.keys(out.failed).map(function (k) { return out.failed[k]; });
      const permissionIssue = messages.every(function (m) { return /permission|not found|forbidden/i.test(m); });
      return send(res, permissionIssue ? 403 : 502, {
        error: 'gsc_api_error',
        message: 'すべてのレポートの取得に失敗しました：' + messages[0],
        hint: permissionIssue
          ? 'Search Console → 設定 → ユーザーと権限 で、サービスアカウントのメールアドレスを追加してください。' +
            'GSC_SITE_URL の形式（ドメインプロパティなら sc-domain:stock-sun.com、URLプレフィックスなら https://stock-sun.com/）も確認してください。'
          : undefined,
        detail: out.failed,
      });
    }
    return send(res, 200, out);
  } catch (e) {
    const status = e.status === 403 ? 403 : e.status === 401 ? 401 : 502;
    return send(res, status, {
      error: 'gsc_api_error',
      message: e.message || 'Search Console API の呼び出しに失敗しました。',
      hint: status === 403
        ? 'Search Console → 設定 → ユーザーと権限 で、サービスアカウントのメールアドレスを追加してください。' +
          'GSC_SITE_URL の形式（ドメインプロパティなら sc-domain:stock-sun.com、URLプレフィックスなら https://stock-sun.com/）も確認してください。'
        : undefined,
    });
  }
};

module.exports.toRows = toRows;
