<#
.SYNOPSIS
  ダッシュボードに必要なGoogle Cloud側の準備を自動化する（フェーズ1）。

.DESCRIPTION
  次を自動でやる：
    - GCPプロジェクトの作成（既存を指定してもよい）
    - 必要なAPIの有効化
    - サービスアカウントの作成とJSON鍵の発行（GA4用）
    - YouTube Data API v3 に限定したAPIキーの発行

  自動化できないもの（Googleがコンソール操作か人間の同意を要求するため）：
    - OAuth同意画面の設定
    - OAuthクライアント（デスクトップアプリ）の作成
    - GA4プロパティへのユーザー追加

  完了後、次にやるコンソール操作の一覧を表示する。

.PARAMETER ProjectId
  作成または使用するGCPプロジェクトID。既存プロジェクトを使う場合はそのIDを渡す。

.PARAMETER KeyDir
  鍵と作業状態を置くディレクトリ。リポジトリの外に置くこと。

.EXAMPLE
  .\tools\setup-1-gcloud.ps1
  .\tools\setup-1-gcloud.ps1 -ProjectId my-existing-project
#>
[CmdletBinding()]
param(
  [string]$ProjectId = "nensyuagent-dash-$(Get-Random -Minimum 1000 -Maximum 9999)",
  [string]$ServiceAccountName = "dashboard-reader",
  [string]$KeyDir = (Join-Path $env:USERPROFILE ".nensyuagent")
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !   $msg" -ForegroundColor Yellow }

# ---------- 事前チェック ----------
Step "事前チェック"

if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
  throw "gcloud が見つかりません。https://cloud.google.com/sdk/docs/install からインストールしてください。"
}
Ok "gcloud あり"

$account = (gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>$null | Select-Object -First 1)
if (-not $account) {
  throw "gcloud にログインしていません。先に『gcloud auth login』を実行してください（ブラウザでの本人認証が必要です）。"
}
Ok "ログイン中: $account"

New-Item -ItemType Directory -Force -Path $KeyDir | Out-Null
Ok "作業ディレクトリ: $KeyDir"

# ---------- プロジェクト ----------
Step "プロジェクトの準備"

$exists = (gcloud projects describe $ProjectId --format="value(projectId)" 2>$null)
if ($exists) {
  Ok "既存プロジェクトを使用: $ProjectId"
} else {
  Write-Host "    プロジェクト $ProjectId を作成します..."
  try {
    gcloud projects create $ProjectId --name="nensyuagent dashboard" | Out-Null
    Ok "作成しました: $ProjectId"
  } catch {
    throw @"
プロジェクトの作成に失敗しました。組織のポリシーで作成が制限されている可能性があります。
既存のプロジェクトを使う場合は、次のように指定して再実行してください：
    .\tools\setup-1-gcloud.ps1 -ProjectId <既存のプロジェクトID>
利用可能なプロジェクト一覧： gcloud projects list
"@
  }
}
gcloud config set project $ProjectId | Out-Null

# ---------- API 有効化 ----------
Step "APIの有効化（少し時間がかかります）"

$apis = @(
  "analyticsdata.googleapis.com",      # GA4（送客タブ）
  "youtube.googleapis.com",            # YouTube Data API v3（公開指標）
  "youtubeanalytics.googleapis.com",   # YouTube Analytics（非公開指標）
  "apikeys.googleapis.com"             # APIキーをCLIから作るのに必要
)
foreach ($api in $apis) {
  gcloud services enable $api --project=$ProjectId | Out-Null
  Ok $api
}

# ---------- サービスアカウント ----------
Step "サービスアカウントの準備（GA4用）"

$saEmail = "$ServiceAccountName@$ProjectId.iam.gserviceaccount.com"
$saExists = (gcloud iam service-accounts describe $saEmail --project=$ProjectId --format="value(email)" 2>$null)
if ($saExists) {
  Ok "既存のサービスアカウントを使用: $saEmail"
} else {
  gcloud iam service-accounts create $ServiceAccountName `
    --project=$ProjectId `
    --display-name="nensyuagent dashboard reader" | Out-Null
  Ok "作成しました: $saEmail"
}

$keyFile = Join-Path $KeyDir "service-account.json"
if (Test-Path $keyFile) {
  Warn "既存の鍵ファイルを使います: $keyFile"
  Warn "新しく発行し直す場合は、このファイルを削除してから再実行してください。"
} else {
  gcloud iam service-accounts keys create $keyFile --iam-account=$saEmail --project=$ProjectId | Out-Null
  Ok "JSON鍵を発行しました: $keyFile"
}

# ---------- APIキー ----------
Step "YouTube用APIキーの準備"

$keyDisplayName = "nensyuagent-youtube"
$keyResource = (gcloud services api-keys list `
  --project=$ProjectId `
  --filter="displayName=$keyDisplayName" `
  --format="value(name)" 2>$null | Select-Object -First 1)

if (-not $keyResource) {
  Write-Host "    APIキーを作成します..."
  gcloud services api-keys create `
    --project=$ProjectId `
    --display-name=$keyDisplayName `
    --api-target=service=youtube.googleapis.com | Out-Null
  Start-Sleep -Seconds 3
  $keyResource = (gcloud services api-keys list `
    --project=$ProjectId `
    --filter="displayName=$keyDisplayName" `
    --format="value(name)" 2>$null | Select-Object -First 1)
}
if (-not $keyResource) { throw "APIキーの作成に失敗しました。コンソールから手動で作成してください。" }

$apiKey = (gcloud services api-keys get-key-string $keyResource --format="value(keyString)")
if (-not $apiKey) { throw "APIキーの取得に失敗しました。" }
Ok "APIキーを取得しました（YouTube Data API v3 に限定済み）"

# ---------- 状態の保存 ----------
# 秘匿値は画面に出さず、リポジトリ外のファイルにだけ書く
$state = [ordered]@{
  projectId           = $ProjectId
  serviceAccountEmail = $saEmail
  keyFile             = $keyFile
  apiKey              = $apiKey
  createdAt           = (Get-Date).ToString("s")
}
$statePath = Join-Path $KeyDir "setup-state.json"
$state | ConvertTo-Json | Set-Content -Path $statePath -Encoding UTF8
Ok "状態を保存しました: $statePath"

# ---------- 次にやること ----------
Write-Host @"

================================================================
 フェーズ1 完了。ここから先はコンソール操作が必要です（4つ）
================================================================

サービスアカウントのメールアドレス（コピーして使ってください）:

    $saEmail

----------------------------------------------------------------
[1] GA4 に閲覧権限を渡す
    https://analytics.google.com/
    管理（左下の歯車）→ ★プロパティ列★ の「プロパティのアクセス管理」
    → 右上の ＋ → ユーザーを追加
    → 上のメールアドレスを貼る
    → 「新規ユーザーにメールで通知する」の【チェックを外す】
    → 役割は「閲覧者」→ 追加

    ※アカウント列ではなくプロパティ列です。対象は 506324594。

----------------------------------------------------------------
[2] OAuth同意画面を設定する（YouTubeの非公開指標用）
    https://console.cloud.google.com/apis/credentials/consent?project=$ProjectId

    ★User Type で「内部」を選べるなら必ず内部にしてください。
      「外部」かつ「テスト中」だと、リフレッシュトークンが7日で失効します。
      外部しか選べない場合は、同意画面を「本番環境に公開」まで進めてください。

----------------------------------------------------------------
[3] OAuthクライアントを作る
    https://console.cloud.google.com/apis/credentials?project=$ProjectId
    → 認証情報を作成 → OAuth クライアント ID
    → アプリケーションの種類は【デスクトップアプリ】
    → 表示されたクライアントIDとシークレットを控える

    その後、リポジトリのルートで次を実行して承認してください：

        `$env:YOUTUBE_CLIENT_ID="控えたクライアントID"
        `$env:YOUTUBE_CLIENT_SECRET="控えたシークレット"
        python tools/get_youtube_refresh_token.py

----------------------------------------------------------------

上の [1] が終われば、次を実行してデプロイできます：

    .\tools\setup-2-deploy.ps1

[2][3] は後回しで構いません。YouTubeの非公開指標が出ないだけです。

"@ -ForegroundColor White

Warn "$keyFile は認証情報です。Vercelに登録したら削除してください。"
