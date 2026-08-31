// YouTube Data API v3 のプロキシ。
// APIキーはサーバー側の環境変数のみで保持し、ブラウザには一切返さない。
const API = 'https://www.googleapis.com/youtube/v3';
const { requireAuth } = require('./_auth.js');

const CHANNEL_RE = /^UC[A-Za-z0-9_-]{22}$/;
const DEFAULT_CHANNEL = 'UCwrivK-bKlDu6ZJzC01GPBw'; // 年収エージェント

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (status === 200) {
    // 30分キャッシュ。APIクォータの消費を抑える。
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
  } else {
    res.setHeader('Cache-Control', 'no-store');
  }
  res.end(JSON.stringify(body));
}

async function gapi(resource, params, key) {
  const qs = new URLSearchParams({ ...params, key });
  const r = await fetch(`${API}/${resource}?${qs}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    // Google のエラーメッセージのみ通す（リクエストURLは鍵を含むので絶対に返さない）
    const msg = (body && body.error && body.error.message) || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    throw err;
  }
  return body;
}

// ISO 8601 duration (PT1H2M3S) → 秒
function toSeconds(iso) {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0);
}

function mapVideo(v) {
  const s = v.statistics || {};
  const views = +s.viewCount || 0;
  const likes = +s.likeCount || 0;
  const comments = +s.commentCount || 0;
  const seconds = toSeconds(v.contentDetails && v.contentDetails.duration);
  return {
    id: v.id,
    title: v.snippet.title,
    publishedAt: v.snippet.publishedAt,
    thumbnail: (((v.snippet.thumbnails || {}).medium) || {}).url || null,
    views,
    likes,
    comments,
    seconds,
    isShort: seconds > 0 && seconds <= 60,
    // エンゲージメント率：(高評価＋コメント) ÷ 再生回数
    engagement: views > 0 ? (likes + comments) / views : 0,
  };
}

module.exports = async (req, res) => {
  if (!requireAuth(req, res)) return;
  const key = process.env.YOUTUBE_API_KEY;
  const url = new URL(req.url, 'http://localhost');
  const channelId = url.searchParams.get('channelId') || process.env.YOUTUBE_CHANNEL_ID || DEFAULT_CHANNEL;
  const max = Math.min(Math.max(parseInt(url.searchParams.get('max'), 10) || 100, 1), 200);

  if (!key) {
    return send(res, 503, {
      error: 'not_configured',
      message: '環境変数 YOUTUBE_API_KEY が設定されていません。Vercel のプロジェクト設定で追加してください。',
      channelId,
    });
  }
  if (!CHANNEL_RE.test(channelId)) {
    return send(res, 400, {
      error: 'bad_channel_id',
      message: 'チャンネルIDの形式が不正です（UC で始まる24文字）。',
    });
  }

  try {
    const chRes = await gapi('channels', { part: 'snippet,statistics,contentDetails', id: channelId }, key);
    const c = chRes.items && chRes.items[0];
    if (!c) {
      return send(res, 404, { error: 'channel_not_found', message: 'チャンネルが見つかりませんでした。' });
    }

    const uploads = c.contentDetails.relatedPlaylists.uploads;
    const ids = [];
    let pageToken;
    while (ids.length < max) {
      const params = { part: 'contentDetails', playlistId: uploads, maxResults: 50 };
      if (pageToken) params.pageToken = pageToken;
      const page = await gapi('playlistItems', params, key);
      for (const item of page.items || []) ids.push(item.contentDetails.videoId);
      pageToken = page.nextPageToken;
      if (!pageToken) break;
    }

    const videos = [];
    for (let i = 0; i < Math.min(ids.length, max); i += 50) {
      const batch = ids.slice(i, i + 50).join(',');
      const vRes = await gapi('videos', { part: 'snippet,statistics,contentDetails', id: batch }, key);
      for (const v of vRes.items || []) videos.push(mapVideo(v));
    }
    videos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const st = c.statistics || {};
    return send(res, 200, {
      fetchedAt: new Date().toISOString(),
      channel: {
        id: c.id,
        title: c.snippet.title,
        description: c.snippet.description,
        publishedAt: c.snippet.publishedAt,
        thumbnail: (((c.snippet.thumbnails || {}).default) || {}).url || null,
        subscriberCount: st.hiddenSubscriberCount ? null : +st.subscriberCount || 0,
        viewCount: +st.viewCount || 0,
        videoCount: +st.videoCount || 0,
      },
      videos,
    });
  } catch (e) {
    return send(res, e.status === 403 ? 403 : 502, {
      error: 'youtube_api_error',
      message: e.message || 'YouTube API の呼び出しに失敗しました。',
    });
  }
};
