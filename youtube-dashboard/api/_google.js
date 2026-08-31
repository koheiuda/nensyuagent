// Google API の認証。依存パッケージゼロ（Node標準の crypto のみ）。
//
// 2種類の認証を扱う：
//   1. サービスアカウント（GA4 Data API）… RS256 の JWT を自前で署名して token と交換
//   2. OAuth リフレッシュトークン（YouTube Analytics API）… チャンネル所有者本人の同意が必要で
//      サービスアカウントでは代替できないため
const crypto = require('crypto');

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

// アクセストークンはプロセス内でキャッシュする（有効期限の60秒前まで再利用）
const cache = new Map();

function b64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function postForm(url, params) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (body && (body.error_description || body.error)) || `HTTP ${r.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = r.status;
    throw err;
  }
  return body;
}

/** サービスアカウントの JSON をパースする。改行が \n にエスケープされていても復元する。 */
function parseServiceAccount(raw) {
  if (!raw) return null;
  let json;
  try {
    // 環境変数にそのまま貼った場合と、base64 で入れた場合の両方を許容する
    json = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
  } catch (e) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON を JSON として解釈できません: ' + e.message);
  }
  if (!json.client_email || !json.private_key) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON に client_email / private_key がありません');
  }
  json.private_key = String(json.private_key).replace(/\\n/g, '\n');
  return json;
}

/** サービスアカウントで署名した JWT を作る（RS256）。 */
function signJwt(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: sa.client_email,
    scope: scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(header + '.' + claim);
  const signature = signer.sign(sa.private_key).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return header + '.' + claim + '.' + signature;
}

/** サービスアカウントでアクセストークンを取得（GA4 用）。 */
async function serviceAccountToken(rawJson, scope) {
  const key = 'sa:' + scope;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;

  const sa = parseServiceAccount(rawJson);
  if (!sa) throw new Error('環境変数 GOOGLE_SERVICE_ACCOUNT_JSON が設定されていません');

  const body = await postForm(TOKEN_URL, {
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: signJwt(sa, scope),
  });
  cache.set(key, { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 });
  return body.access_token;
}

/** リフレッシュトークンでアクセストークンを取得（YouTube Analytics 用）。 */
async function refreshTokenToken(clientId, clientSecret, refreshToken) {
  const key = 'rt:' + refreshToken.slice(-12);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 60000) return hit.token;

  const body = await postForm(TOKEN_URL, {
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  cache.set(key, { token: body.access_token, exp: Date.now() + (body.expires_in || 3600) * 1000 });
  return body.access_token;
}

/** 認証付きの GET/POST。エラー時も Google のメッセージのみ通し、トークンは絶対に返さない。 */
async function authedFetch(url, token, init) {
  const r = await fetch(url, Object.assign({}, init, {
    headers: Object.assign({ Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      (init && init.headers) || {}),
  }));
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (body && body.error && (body.error.message || body.error)) || `HTTP ${r.status}`;
    const err = new Error(typeof msg === 'string' ? msg : JSON.stringify(msg));
    err.status = r.status;
    throw err;
  }
  return body;
}

module.exports = {
  parseServiceAccount,
  signJwt,
  serviceAccountToken,
  refreshTokenToken,
  authedFetch,
};
