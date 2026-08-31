// APIエンドポイントの保護。
//
// デプロイURLは推測されにくいだけで公開されている。認証がないと、URLを知った人は
// 誰でもチャンネルの数値とGA4のCV数を読めてしまう。
//
// DASHBOARD_USER と DASHBOARD_PASSWORD が設定されている場合のみ Basic 認証を要求する。
// 未設定なら素通しする（ローカル開発と、Vercel の Deployment Protection を使う場合のため）。
const crypto = require('crypto');

/** タイミング攻撃を避けるため、長さの違いも含めて定数時間で比較する。 */
function safeEqual(a, b) {
  const ba = Buffer.from(String(a), 'utf8');
  const bb = Buffer.from(String(b), 'utf8');
  // 長さが違うと timingSafeEqual が例外を投げるので、ハッシュに揃えてから比較する
  const ha = crypto.createHash('sha256').update(ba).digest();
  const hb = crypto.createHash('sha256').update(bb).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * 認証を確認する。通過したら true。
 * 失敗した場合はこの関数が 401 を返し終えているので、呼び出し側は即 return する。
 */
function requireAuth(req, res) {
  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;
  if (!user || !pass) return true; // 未設定なら保護しない

  const header = req.headers && (req.headers.authorization || req.headers.Authorization);
  const m = /^Basic\s+(.+)$/i.exec(header || '');
  if (m) {
    let decoded = '';
    try { decoded = Buffer.from(m[1], 'base64').toString('utf8'); } catch (e) { decoded = ''; }
    const i = decoded.indexOf(':');
    if (i > -1) {
      const okUser = safeEqual(decoded.slice(0, i), user);
      const okPass = safeEqual(decoded.slice(i + 1), pass);
      // 両方を必ず評価してから判定する（早期returnで差が出ないように）
      if (okUser && okPass) return true;
    }
  }

  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="analytics", charset="UTF-8"');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ error: 'unauthorized', message: '認証が必要です。' }));
  return false;
}

module.exports = { requireAuth, safeEqual };
