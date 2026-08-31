#!/usr/bin/env bash
# ダッシュボードに必要な Google Cloud 側の準備（フェーズ1）。
# PowerShell版 tools/setup-1-gcloud.ps1 の macOS / Linux / Git Bash 版。
#
# 自動化できないもの（Googleがコンソール操作か人間の同意を要求するため）:
#   OAuth同意画面 / OAuthクライアント作成 / GA4へのユーザー追加 / Search Consoleへのユーザー追加
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-nensyuagent-dash-$RANDOM}"
SA_NAME="${SA_NAME:-dashboard-reader}"
KEY_DIR="${KEY_DIR:-$HOME/.nensyuagent}"

step() { printf '\n==> %s\n' "$1"; }
ok()   { printf '    OK  %s\n' "$1"; }
warn() { printf '    !   %s\n' "$1"; }

step "事前チェック"
command -v gcloud >/dev/null || { echo "gcloud が見つかりません。https://cloud.google.com/sdk/docs/install"; exit 1; }
ok "gcloud あり"
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null | head -1 || true)
[ -n "$ACCOUNT" ] || { echo "gcloud にログインしていません。先に 'gcloud auth login' を実行してください。"; exit 1; }
ok "ログイン中: $ACCOUNT"
mkdir -p "$KEY_DIR"; ok "作業ディレクトリ: $KEY_DIR"

step "プロジェクトの準備"
if gcloud projects describe "$PROJECT_ID" --format="value(projectId)" >/dev/null 2>&1; then
  ok "既存プロジェクトを使用: $PROJECT_ID"
else
  gcloud projects create "$PROJECT_ID" --name="nensyuagent dashboard" >/dev/null || {
    echo "プロジェクト作成に失敗しました。既存のものを使う場合: PROJECT_ID=<既存ID> $0"; exit 1; }
  ok "作成しました: $PROJECT_ID"
fi
gcloud config set project "$PROJECT_ID" >/dev/null

step "APIの有効化（少し時間がかかります）"
for api in analyticsdata.googleapis.com searchconsole.googleapis.com \
           youtube.googleapis.com youtubeanalytics.googleapis.com apikeys.googleapis.com; do
  gcloud services enable "$api" --project="$PROJECT_ID" >/dev/null
  ok "$api"
done

step "サービスアカウントの準備（GA4 と Search Console 用）"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"
if gcloud iam service-accounts describe "$SA_EMAIL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  ok "既存のサービスアカウントを使用: $SA_EMAIL"
else
  gcloud iam service-accounts create "$SA_NAME" --project="$PROJECT_ID" \
    --display-name="nensyuagent dashboard reader" >/dev/null
  ok "作成しました: $SA_EMAIL"
fi

KEY_FILE="$KEY_DIR/service-account.json"
if [ -f "$KEY_FILE" ]; then
  warn "既存の鍵ファイルを使います: $KEY_FILE"
else
  gcloud iam service-accounts keys create "$KEY_FILE" --iam-account="$SA_EMAIL" --project="$PROJECT_ID" >/dev/null
  chmod 600 "$KEY_FILE"
  ok "JSON鍵を発行しました: $KEY_FILE"
fi

step "YouTube用APIキーの準備"
KEY_DISPLAY="nensyuagent-youtube"
KEY_RES=$(gcloud services api-keys list --project="$PROJECT_ID" \
  --filter="displayName=$KEY_DISPLAY" --format="value(name)" 2>/dev/null | head -1 || true)
if [ -z "$KEY_RES" ]; then
  gcloud services api-keys create --project="$PROJECT_ID" \
    --display-name="$KEY_DISPLAY" --api-target=service=youtube.googleapis.com >/dev/null
  sleep 3
  KEY_RES=$(gcloud services api-keys list --project="$PROJECT_ID" \
    --filter="displayName=$KEY_DISPLAY" --format="value(name)" 2>/dev/null | head -1 || true)
fi
[ -n "$KEY_RES" ] || { echo "APIキーの作成に失敗しました。コンソールから手動で作成してください。"; exit 1; }
API_KEY=$(gcloud services api-keys get-key-string "$KEY_RES" --format="value(keyString)")
[ -n "$API_KEY" ] || { echo "APIキーの取得に失敗しました。"; exit 1; }
ok "APIキーを取得しました（YouTube Data API v3 に限定済み）"

# 秘匿値は画面に出さず、リポジトリ外のファイルにだけ書く
STATE="$KEY_DIR/setup-state.json"
cat > "$STATE" <<JSON
{
  "projectId": "$PROJECT_ID",
  "serviceAccountEmail": "$SA_EMAIL",
  "keyFile": "$KEY_FILE",
  "apiKey": "$API_KEY"
}
JSON
chmod 600 "$STATE"
ok "状態を保存しました: $STATE"

cat <<TXT

================================================================
 フェーズ1 完了。ここから先はコンソール操作が必要です（4つ）
================================================================

サービスアカウントのメールアドレス:

    $SA_EMAIL

[1] GA4 に閲覧権限を渡す  https://analytics.google.com/
    管理 → ★プロパティ列★ のアクセス管理 → ＋ → ユーザーを追加
    → 上のアドレス／「メールで通知する」の【チェックを外す】／役割は「閲覧者」
    ※対象プロパティは 506324594

[2] Search Console に権限を渡す  https://search.google.com/search-console
    設定 → ユーザーと権限 → ユーザーを追加 → 上のアドレス／権限は「制限付き」
    ※GA4に追加しただけでは通りません
    ※プロパティの種類を確認:
        ドメイン          → GSC_SITE_URL=sc-domain:stock-sun.com
        URLプレフィックス → GSC_SITE_URL=https://stock-sun.com/

[3] OAuth同意画面を設定
    https://console.cloud.google.com/apis/credentials/consent?project=$PROJECT_ID
    ★「内部」を選べるなら必ず内部に。「外部・テスト中」だとトークンが7日で失効します

[4] OAuthクライアントを作る（種類は【デスクトップアプリ】）
    https://console.cloud.google.com/apis/credentials?project=$PROJECT_ID
    その後:
        export YOUTUBE_CLIENT_ID='...'
        export YOUTUBE_CLIENT_SECRET='...'
        python tools/get_youtube_refresh_token.py

[1][2] が終われば次へ:

    ./tools/setup-2-deploy.sh "sc-domain:stock-sun.com"

[3][4] は後回しで構いません（YouTubeの非公開指標が出ないだけです）。

TXT
warn "$KEY_FILE は認証情報です。Vercelに登録したら削除してください。"
