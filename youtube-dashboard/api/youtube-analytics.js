// YouTube Analytics API v2（非公開指標：視聴維持率・総再生時間・登録者増減・流入元）。
//
// サービスアカウントでは代替できない。チャンネル所有者本人のOAuth同意が必要なため、
// リフレッシュトークン方式を使う。トークンの発行は tools/get_youtube_refresh_token.py を一度だけ実行する。
const { refreshTokenToken, authedFetch } = require('./_google.js');

const { requireAuth } = require('./_auth.js');

const BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';
const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const DEFAULT_CHANNEL = 'UCwrivK-bKlDu6ZJzC01GPBw';
// YouTube Analytics は1〜2日遅れて確定する。直前まで取ると最新の数日だけ不当に低く出て、
// 推移グラフが「落ちている」ように誤読される。確定している分だけを対象にする。
const LAG_DAYS = 2;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 's-maxage=1800, stale-while-revalidate=3600' : 'no-store');
  res.end(JSON.stringify(body));
}

// サムネイルのインプレッション／CTRは Query API v2 の対象外（Reporting API のReachレポート）なので、
// ここでは取得可能な指標だけを要求する。
const REPORTS = {
  daily: {
    dimensions: 'day',
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost',
    sort: 'day',
  },
  video: {
    dimensions: 'video',
    metrics: 'views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments',
    sort: '-views',
    maxResults: 200,
  },
  trafficSource: {
    dimensions: 'insightTrafficSourceType',
    metrics: 'views,estimatedMinutesWatched',
    sort: '-views',
  },
};

/** YouTube Analytics のレスポンス（columnHeaders + rows）を配列オブジェクトに均す。 */
function toRows(payload) {
  const cols = (payload.columnHeaders || []).map(function (c) { return c.name; });
  return (payload.rows || []).map(function (r) {
    const o = {};
    cols.forEach(function (name, i) { o[name] = r[i]; });
    return o;
  });
}

function isoDaysAgo(days) {
  const d = new Date(Date.now() - days * 86400000);
  return d.toISOString().slice(0, 10);
}

// Analytics の上位動画は「最新200本」と一致しないため、レポート内の動画IDを直接引いて
// タイトル・公開日・累計値を補完する。videos.list は最大50 IDずつ。
async function fetchVideoMetadata(token, rows) {
  const ids = Array.from(new Set((rows || []).map(function (row) { return row.video; }).filter(Boolean)));
  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const qs = new URLSearchParams({
      part: 'snippet,statistics,contentDetails',
      id: ids.slice(i, i + 50).join(','),
      maxResults: '50',
    });
    const payload = await authedFetch(`https://www.googleapis.com/youtube/v3/videos?${qs}`, token, { method: 'GET' });
    for (const item of payload.items || []) {
      const statistics = item.statistics || {};
      videos.push({
        id: item.id,
        title: item.snippet && item.snippet.title,
        publishedAt: item.snippet && item.snippet.publishedAt,
        thumbnail: item.snippet && item.snippet.thumbnails &&
          ((item.snippet.thumbnails.medium || item.snippet.thumbnails.default || {}).url || null),
        views: Number(statistics.viewCount) || 0,
        likes: Number(statistics.likeCount) || 0,
        comments: Number(statistics.commentCount) || 0,
        duration: item.contentDetails && item.contentDetails.duration,
      });
    }
  }
  return videos;
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  const clientId = process.env.YOUTUBE_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET;
  const refresh = process.env.YOUTUBE_REFRESH_TOKEN;
  const url = new URL(req.url, 'http://localhost');
  const channelId = url.searchParams.get('channelId') || process.env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL;
  const days = Math.min(Math.max(parseInt(url.searchParams.get('days'), 10) || 90, 1), 730);

  if (!clientId || !clientSecret || !refresh) {
    return send(res, 503, {
      error: 'not_configured',
      message: 'YouTube Analytics（非公開指標）には OAuth が必要です。' +
               'tools/get_youtube_refresh_token.py を一度実行してリフレッシュトークンを発行し、環境変数に設定してください。',
      needs: ['YOUTUBE_CLIENT_ID', 'YOUTUBE_CLIENT_SECRET', 'YOUTUBE_REFRESH_TOKEN'],
    });
  }
  if (!CHANNEL_RE.test(channelId)) {
    return send(res, 400, { error: 'bad_channel_id', message: 'チャンネルIDの形式が不正です。' });
  }

  const startDate = isoDaysAgo(days + LAG_DAYS);
  const endDate = isoDaysAgo(LAG_DAYS);

  try {
    const token = await refreshTokenToken(clientId, clientSecret, refresh);
    const mine = await authedFetch(
      'https://www.googleapis.com/youtube/v3/channels?part=id&mine=true&maxResults=50',
      token,
      { method: 'GET' }
    );
    const authorizedChannelIds = (mine.items || []).map(function (item) { return item.id; });
    if (!authorizedChannelIds.includes(channelId)) {
      return send(res, 403, {
        error: 'wrong_youtube_account',
        message: 'OAuthで承認したGoogleアカウントは、対象のYouTubeチャンネルを所有していません。',
        channelId,
        authorizedChannelIds,
      });
    }

    const out = { fetchedAt: new Date().toISOString(), channelId, startDate, endDate,
                  lagDays: LAG_DAYS, reports: {}, failed: {} };

    for (const [name, params] of Object.entries(REPORTS)) {
      const qs = new URLSearchParams(Object.assign({
        ids: 'channel==MINE',
        startDate,
        endDate,
      }, params));
      try {
        const payload = await authedFetch(`${BASE}?${qs}`, token, { method: 'GET' });
        out.reports[name] = toRows(payload);
      } catch (e) {
        // 権限レベルや指標の対応状況で一部だけ落ちることがある。全体は止めない。
        out.failed[name] = e.message || 'unknown error';
      }
    }

    if (out.reports.video && out.reports.video.length) {
      try {
        out.videoMetadata = await fetchVideoMetadata(token, out.reports.video);
      } catch (e) {
        // 分析指標は返し、メタデータ補完だけ失敗として明示する。
        out.failed.videoMetadata = e.message || 'unknown error';
        out.videoMetadata = [];
      }
    }

    if (!Object.keys(out.reports).length) {
      return send(res, 502, {
        error: 'youtube_analytics_error',
        message: 'すべてのレポートの取得に失敗しました。',
        detail: out.failed,
      });
    }
    return send(res, 200, out);
  } catch (e) {
    const status = e.status === 401 ? 401 : e.status === 403 ? 403 : 502;
    return send(res, status, {
      error: 'youtube_analytics_error',
      message: e.message || 'YouTube Analytics API の呼び出しに失敗しました。',
      hint: status === 401
        ? 'リフレッシュトークンが失効している可能性があります。tools/get_youtube_refresh_token.py を再実行してください。'
        : undefined,
    });
  }
};

module.exports.toRows = toRows;
module.exports.REPORTS = REPORTS;
module.exports.fetchVideoMetadata = fetchVideoMetadata;
