// GA4 Data API v1beta。/nensyuagent/ 配下だけを対象にする。
// StockSun本体と同一プロパティのため、パス絞り込みは必須。
const { serviceAccountToken, authedFetch } = require('./_google.js');

const { requireAuth } = require('./_auth.js');

const SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const BASE = 'https://analyticsdata.googleapis.com/v1beta';
const PATH_PREFIX = '/nensyuagent/';
const INQUIRY_EVENT = 'CV_求職者all';
const YOUTUBE_DESCRIPTION_CONTENT = 'agent-ch_desc';
const YOUTUBE_CHANNEL_CONTENT_PREFIX = 'agent-ch_';
const YOUTUBE_TAGGED_SOURCE_MEDIUM = 'youtube / video';
const YOUTUBE_REFERRAL_SOURCE_MEDIUM = 'youtube.com / referral';
// YouTube Analytics の確定遅延に合わせ、クロスチャネル比較は T-3 まで。
const LAG_DAYS = 3;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=1800, stale-while-revalidate=3600' : 'no-store');
  res.end(JSON.stringify(body));
}

function pathFilter() {
  return {
    filter: { fieldName: 'pagePath', stringFilter: { matchType: 'FULL_REGEXP', value: '^/nensyuagent(?:/|$)' } },
  };
}

function andFilter(filters) {
  return { andGroup: { expressions: filters } };
}

function exactFilter(fieldName, value) {
  return { filter: { fieldName, stringFilter: { matchType: 'EXACT', value, caseSensitive: true } } };
}

function youtubeDescriptionFilter() {
  return andFilter([
    exactFilter('sessionSourceMedium', YOUTUBE_TAGGED_SOURCE_MEDIUM),
    { filter: { fieldName: 'sessionManualAdContent', stringFilter: { matchType: 'BEGINS_WITH', value: YOUTUBE_DESCRIPTION_CONTENT, caseSensitive: true } } },
  ]);
}

function youtubeChannelFilter() {
  return andFilter([
    exactFilter('sessionSourceMedium', YOUTUBE_TAGGED_SOURCE_MEDIUM),
    { filter: { fieldName: 'sessionManualAdContent', stringFilter: { matchType: 'BEGINS_WITH', value: YOUTUBE_CHANNEL_CONTENT_PREFIX, caseSensitive: true } } },
  ]);
}

function youtubeReferralFilter() {
  return exactFilter('sessionSourceMedium', YOUTUBE_REFERRAL_SOURCE_MEDIUM);
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
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
  if (!requireAuth(req, res)) return;
  const propertyId = process.env.GA4_PROPERTY_ID;
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  const url = new URL(req.url, 'http://localhost');
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 90, 1), 400);
  // YouTube Analyticsと分子・分母の期間を一致させるため、GA4も直近3日を除外する。
  const startDate = `${days + LAG_DAYS - 1}daysAgo`;
  const endDate = `${LAG_DAYS}daysAgo`;

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
    const dateRanges = [{ startDate, endDate }];
    const previousDateRanges = [{ startDate: `${days * 2 + LAG_DAYS - 1}daysAgo`, endDate: `${days + LAG_DAYS}daysAgo` }];
    const baseMetrics = [{ name: 'sessions' }, { name: 'activeUsers' }, { name: 'screenPageViews' }];
    const summaryMetrics = baseMetrics.concat([{ name: 'sessionKeyEventRate' }]);

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

    // 4) 年収エージェントchの概要欄UTMだけを分離（共有されたGA4計測定義）
    const youtube = await runWithKeyEvents(propertyId, token, {
      dateRanges,
      dimensions: [{ name: 'date' }],
      metrics: summaryMetrics,
      dimensionFilter: youtubeDescriptionFilter(),
      orderBys: [{ dimension: { dimensionName: 'date' } }],
      limit: 400,
    });

    // 期間ユニークユーザーや率は日別合算できないため、dimensionなしのsummaryを使う。
    const summary = await runWithKeyEvents(propertyId, token, {
      dateRanges,
      dimensions: [],
      metrics: summaryMetrics,
      dimensionFilter: pathFilter(),
      limit: 1,
    });
    const youtubeSummary = await runWithKeyEvents(propertyId, token, {
      dateRanges,
      dimensions: [],
      metrics: summaryMetrics,
      dimensionFilter: youtubeDescriptionFilter(),
      limit: 1,
    });
    const previousSummary = await runWithKeyEvents(propertyId, token, {
      dateRanges: previousDateRanges,
      dimensions: [],
      metrics: summaryMetrics,
      dimensionFilter: pathFilter(),
      limit: 1,
    });
    const previousYoutubeSummary = await runWithKeyEvents(propertyId, token, {
      dateRanges: previousDateRanges,
      dimensions: [],
      metrics: summaryMetrics,
      dimensionFilter: youtubeDescriptionFilter(),
      limit: 1,
    });

    // 問い合わせ完了はイベント名を固定し、GA4の「キーイベント全体」と混同しない。
    const inquiryBase = {
      dimensions: [], metrics: [{ name: 'eventCount' }],
      dimensionFilter: exactFilter('eventName', INQUIRY_EVENT), limit: 1,
    };
    const inquirySummary = await runReport(propertyId, token, Object.assign({ dateRanges }, inquiryBase));
    const previousInquirySummary = await runReport(propertyId, token, Object.assign({ dateRanges: previousDateRanges }, inquiryBase));
    const youtubeInquiryFilter = andFilter([youtubeDescriptionFilter(), exactFilter('eventName', INQUIRY_EVENT)]);
    const youtubeInquirySummary = await runReport(propertyId, token, {
      dateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeInquiryFilter, limit: 1,
    });
    const previousYoutubeInquirySummary = await runReport(propertyId, token, {
      dateRanges: previousDateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeInquiryFilter, limit: 1,
    });
    const youtubeInquiryDaily = await runReport(propertyId, token, {
      dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: youtubeInquiryFilter,
      orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400,
    });

    // 計測管理表上の年収エージェントchは agent-ch_*。
    // 概要欄だけでなく固定コメント等も含むチャンネル合計と、UTMなしのYouTube referralを分離する。
    const youtubeChannelInquiryFilter = andFilter([youtubeChannelFilter(), exactFilter('eventName', INQUIRY_EVENT)]);
    const youtubeReferralInquiryFilter = andFilter([youtubeReferralFilter(), exactFilter('eventName', INQUIRY_EVENT)]);
    const [channelDaily, channelSummary, previousChannelSummary, channelInquirySummary,
      previousChannelInquirySummary, channelInquiryDaily, referralSummary, previousReferralSummary,
      referralInquirySummary, previousReferralInquirySummary] = await Promise.all([
      runReport(propertyId, token, {
        dateRanges, dimensions: [{ name: 'date' }], metrics: summaryMetrics,
        dimensionFilter: youtubeChannelFilter(), orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400,
      }),
      runReport(propertyId, token, { dateRanges, dimensions: [], metrics: summaryMetrics, dimensionFilter: youtubeChannelFilter(), limit: 1 }),
      runReport(propertyId, token, { dateRanges: previousDateRanges, dimensions: [], metrics: summaryMetrics, dimensionFilter: youtubeChannelFilter(), limit: 1 }),
      runReport(propertyId, token, { dateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeChannelInquiryFilter, limit: 1 }),
      runReport(propertyId, token, { dateRanges: previousDateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeChannelInquiryFilter, limit: 1 }),
      runReport(propertyId, token, { dateRanges, dimensions: [{ name: 'date' }], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeChannelInquiryFilter, orderBys: [{ dimension: { dimensionName: 'date' } }], limit: 400 }),
      runReport(propertyId, token, { dateRanges, dimensions: [], metrics: summaryMetrics, dimensionFilter: youtubeReferralFilter(), limit: 1 }),
      runReport(propertyId, token, { dateRanges: previousDateRanges, dimensions: [], metrics: summaryMetrics, dimensionFilter: youtubeReferralFilter(), limit: 1 }),
      runReport(propertyId, token, { dateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeReferralInquiryFilter, limit: 1 }),
      runReport(propertyId, token, { dateRanges: previousDateRanges, dimensions: [], metrics: [{ name: 'eventCount' }], dimensionFilter: youtubeReferralInquiryFilter, limit: 1 }),
    ]);

    // utm_id（sessionManualCampaignId）をYouTube動画IDとして、概要欄・固定コメント等の動画別送客を取得する。
    const [byVideoSessions, byVideoInquiries, previousByVideoSessions, previousByVideoInquiries,
      byCampaignSessions, byCampaignInquiries] = await Promise.all([runReport(propertyId, token, {
      dateRanges, dimensions: [{ name: 'sessionManualCampaignId' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      dimensionFilter: youtubeChannelFilter(),
      orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 200,
    }), runReport(propertyId, token, {
      dateRanges, dimensions: [{ name: 'sessionManualCampaignId' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: youtubeChannelInquiryFilter,
      orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 200,
    }), runReport(propertyId, token, {
      dateRanges: previousDateRanges, dimensions: [{ name: 'sessionManualCampaignId' }],
      metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], dimensionFilter: youtubeChannelFilter(), limit: 200,
    }), runReport(propertyId, token, {
      dateRanges: previousDateRanges, dimensions: [{ name: 'sessionManualCampaignId' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: youtubeChannelInquiryFilter, limit: 200,
    }), runReport(propertyId, token, {
      dateRanges, dimensions: [{ name: 'sessionCampaignName' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }],
      dimensionFilter: youtubeChannelFilter(), orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 50,
    }), runReport(propertyId, token, {
      dateRanges, dimensions: [{ name: 'sessionCampaignName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: youtubeChannelInquiryFilter, orderBys: [{ metric: { metricName: 'eventCount' }, desc: true }], limit: 50,
    })]);
    const sessionsById = {}, usersById = {}, inquiriesById = {};
    const previousSessionsById = {}, previousUsersById = {}, previousInquiriesById = {};
    toRows(byVideoSessions).forEach(function (row) {
      sessionsById[row.sessionManualCampaignId] = row.sessions;
      usersById[row.sessionManualCampaignId] = row.activeUsers;
    });
    toRows(byVideoInquiries).forEach(function (row) { inquiriesById[row.sessionManualCampaignId] = row.eventCount; });
    toRows(previousByVideoSessions).forEach(function (row) {
      previousSessionsById[row.sessionManualCampaignId] = row.sessions;
      previousUsersById[row.sessionManualCampaignId] = row.activeUsers;
    });
    toRows(previousByVideoInquiries).forEach(function (row) { previousInquiriesById[row.sessionManualCampaignId] = row.eventCount; });
    const allVideoIds = Array.from(new Set(Object.keys(sessionsById).concat(Object.keys(inquiriesById), Object.keys(previousSessionsById), Object.keys(previousInquiriesById))));
    const byVideo = allVideoIds.map(function (id) {
      const row = { sessionManualCampaignId: id, sessions: sessionsById[id] || 0, activeUsers: usersById[id] || 0 };
      row.inquiries = inquiriesById[id] || 0;
      row.sessionInquiryRate = row.sessions ? row.inquiries / row.sessions : 0;
      row.previousSessions = previousSessionsById[id] || 0;
      row.previousActiveUsers = previousUsersById[id] || 0;
      row.previousInquiries = previousInquiriesById[id] || 0;
      return row;
    }).sort(function (a, b) { return b.sessions - a.sessions || b.previousSessions - a.previousSessions; });
    const campaignInquiryMap = {};
    toRows(byCampaignInquiries).forEach(function (row) { campaignInquiryMap[row.sessionCampaignName] = row.eventCount; });
    const byCampaign = toRows(byCampaignSessions).map(function (row) {
      row.inquiries = campaignInquiryMap[row.sessionCampaignName] || 0;
      row.sessionInquiryRate = row.sessions ? row.inquiries / row.sessions : 0;
      return row;
    });
    const utmCoverage = byVideo.reduce(function (out, row) {
      const valid = /^[A-Za-z0-9_-]{11}$/.test(row.sessionManualCampaignId || '');
      out.totalSessions += row.sessions || 0;
      if (valid) { out.attributedSessions += row.sessions || 0; out.validVideoIds += 1; }
      else { out.unattributedSessions += row.sessions || 0; out.invalidIds.push(row.sessionManualCampaignId || '(not set)'); }
      return out;
    }, { totalSessions: 0, attributedSessions: 0, unattributedSessions: 0, validVideoIds: 0, invalidIds: [] });
    utmCoverage.rate = utmCoverage.totalSessions ? utmCoverage.attributedSessions / utmCoverage.totalSessions : 0;

    return send(res, 200, {
      fetchedAt: new Date().toISOString(),
      propertyId,
      pathPrefix: PATH_PREFIX,
      days,
      conversionMetric: daily.conversionMetric,
      youtubeConversionMetric: youtube.conversionMetric,
      inquiryEventName: INQUIRY_EVENT,
      youtubeDescriptionContent: YOUTUBE_DESCRIPTION_CONTENT,
      youtubeChannelContentPrefix: YOUTUBE_CHANNEL_CONTENT_PREFIX,
      youtubeTaggedSourceMedium: YOUTUBE_TAGGED_SOURCE_MEDIUM,
      youtubeReferralSourceMedium: YOUTUBE_REFERRAL_SOURCE_MEDIUM,
      summary: toRows(summary.report)[0] || {},
      youtubeSummary: toRows(youtubeSummary.report)[0] || {},
      previousSummary: toRows(previousSummary.report)[0] || {},
      previousYoutubeSummary: toRows(previousYoutubeSummary.report)[0] || {},
      inquirySummary: toRows(inquirySummary)[0] || {},
      previousInquirySummary: toRows(previousInquirySummary)[0] || {},
      youtubeInquirySummary: toRows(youtubeInquirySummary)[0] || {},
      previousYoutubeInquirySummary: toRows(previousYoutubeInquirySummary)[0] || {},
      youtubeInquiryDaily: toRows(youtubeInquiryDaily),
      youtubeChannelSummary: toRows(channelSummary)[0] || {},
      previousYoutubeChannelSummary: toRows(previousChannelSummary)[0] || {},
      youtubeChannelInquirySummary: toRows(channelInquirySummary)[0] || {},
      previousYoutubeChannelInquirySummary: toRows(previousChannelInquirySummary)[0] || {},
      youtubeChannelDaily: toRows(channelDaily),
      youtubeChannelInquiryDaily: toRows(channelInquiryDaily),
      youtubeReferralSummary: toRows(referralSummary)[0] || {},
      previousYoutubeReferralSummary: toRows(previousReferralSummary)[0] || {},
      youtubeReferralInquirySummary: toRows(referralInquirySummary)[0] || {},
      previousYoutubeReferralInquirySummary: toRows(previousReferralInquirySummary)[0] || {},
      period: {
        startDate: isoDaysAgo(days + LAG_DAYS - 1), endDate: isoDaysAgo(LAG_DAYS),
        previousStartDate: isoDaysAgo(days * 2 + LAG_DAYS - 1), previousEndDate: isoDaysAgo(days + LAG_DAYS), days,
      },
      daily: toRows(daily.report),
      bySourceMedium: toRows(bySource),
      byPage: toRows(byPage),
      youtubeDaily: toRows(youtube.report),
      byVideo,
      byCampaign,
      utmCoverage,
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
