#!/usr/bin/env bash
# Vercelへのデプロイと環境変数登録（フェーズ2）。
# 使い方: ./tools/setup-2-deploy.sh "sc-domain:stock-sun.com"
#   任意: DASHBOARD_USER / DASHBOARD_PASSWORD を環境変数で渡すとBasic認証をかける
#   任意: YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET / YOUTUBE_REFRESH_TOKEN で非公開指標も有効化
set -euo pipefail

GSC_SITE_URL="${1:-}"
GA4_PROPERTY_ID="${GA4_PROPERTY_ID:-506324594}"
KEY_DIR="${KEY_DIR:-$HOME/.nensyuagent}"

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    OK  %s\n' "$1"; }
warn() { printf '    !   %s\n' "$1"; }

[ -n "$GSC_SITE_URL" ] || {
  echo "使い方: $0 \"sc-domain:stock-sun.com\"  （Search Consoleのプロパティ形式に合わせてください）"; exit 1; }

step "事前チェック"
command -v npx >/dev/null || { echo "npx が見つかりません。Node.js をインストールしてください。"; exit 1; }
ok "npx あり"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="$REPO_ROOT/youtube-dashboard"
[ -f "$APP_DIR/index.html" ] || { echo "ダッシュボードが見つかりません: $APP_DIR"; exit 1; }
ok "アプリ: $APP_DIR"

STATE="$KEY_DIR/setup-state.json"
[ -f "$STATE" ] || { echo "状態ファイルがありません: $STATE
先に ./tools/setup-1-gcloud.sh を実行してください。"; exit 1; }

# jq が無い環境も想定し、python3 で読む
read_state() { python3 -c "import json,sys;print(json.load(open('$STATE'))['$1'])"; }
KEY_FILE="$(read_state keyFile)"
API_KEY="$(read_state apiKey)"
SA_EMAIL="$(read_state serviceAccountEmail)"
[ -f "$KEY_FILE" ] || { echo "サービスアカウントの鍵が見つかりません: $KEY_FILE"; exit 1; }
ok "サービスアカウント: $SA_EMAIL"

case "$GSC_SITE_URL" in
  sc-domain:*|https://*/|http://*/) ;;
  *) warn "GSC_SITE_URL の形式が想定と異なります: $GSC_SITE_URL"
     warn "ドメインプロパティなら 'sc-domain:stock-sun.com'、URLプレフィックスなら 'https://stock-sun.com/'";;
esac

step "Vercelへデプロイ（初回）"
cd "$APP_DIR"
npx --yes vercel@latest deploy --prod --yes
ok "デプロイしました"

step "環境変数の登録"
# JSONは改行を含むため base64 で1行にする（サーバー側で自動判別）
if base64 --help 2>&1 | grep -q -- '-w'; then
  SA_B64=$(base64 -w0 "$KEY_FILE")      # GNU
else
  SA_B64=$(base64 -i "$KEY_FILE" | tr -d '\n')   # BSD/macOS
fi

set_env() {  # $1=名前 $2=値
  npx --yes vercel@latest env rm "$1" production --yes >/dev/null 2>&1 || true
  printf '%s' "$2" | npx --yes vercel@latest env add "$1" production >/dev/null
  ok "$1"   # 値は表示しない
}

set_env GA4_PROPERTY_ID "$GA4_PROPERTY_ID"
set_env GSC_SITE_URL "$GSC_SITE_URL"
set_env GOOGLE_SERVICE_ACCOUNT_JSON "$SA_B64"
set_env YOUTUBE_API_KEY "$API_KEY"

if [ -n "${DASHBOARD_USER:-}" ] && [ -n "${DASHBOARD_PASSWORD:-}" ]; then
  set_env DASHBOARD_USER "$DASHBOARD_USER"
  set_env DASHBOARD_PASSWORD "$DASHBOARD_PASSWORD"
else
  warn "DASHBOARD_USER / DASHBOARD_PASSWORD が未設定です。誰でもURLから数値を読める状態になります。"
fi

if [ -n "${YOUTUBE_CLIENT_ID:-}" ] && [ -n "${YOUTUBE_CLIENT_SECRET:-}" ] && [ -n "${YOUTUBE_REFRESH_TOKEN:-}" ]; then
  set_env YOUTUBE_CLIENT_ID "$YOUTUBE_CLIENT_ID"
  set_env YOUTUBE_CLIENT_SECRET "$YOUTUBE_CLIENT_SECRET"
  set_env YOUTUBE_REFRESH_TOKEN "$YOUTUBE_REFRESH_TOKEN"
else
  warn "YouTubeのOAuth情報が未設定です。インプレッション・CTR・視聴維持率は表示されません。"
fi

step "環境変数を反映するため再デプロイ"
npx --yes vercel@latest deploy --prod --yes
ok "反映しました"

cat <<TXT

================================================================
 デプロイ完了
================================================================
上に表示されたURLを開いて確認してください。

権限エラーが出たら:
  GA4  → プロパティ列のアクセス管理に $SA_EMAIL を「閲覧者」で追加したか
  GSC  → Search Console 側にも別途追加が必要。GSC_SITE_URL の形式も確認

後始末（Vercelに入ったので手元の鍵は不要です）:
  rm "$KEY_FILE" "$STATE"
  ※ setup-state.json にはAPIキーが入っています。

TXT
