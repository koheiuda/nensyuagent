<#
.SYNOPSIS
  ダッシュボードをVercelにデプロイし、環境変数を登録する（フェーズ2）。

.DESCRIPTION
  setup-1-gcloud.ps1 が保存した状態ファイルを読み、次を自動でやる：
    - Vercelへのデプロイ（プロジェクトが無ければ作成）
    - 環境変数の登録（サービスアカウントJSONはbase64化して渡す）
    - 反映のための再デプロイ

  YouTubeのOAuth（非公開指標）は任意。3つとも渡したときだけ登録する。

.EXAMPLE
  .\tools\setup-2-deploy.ps1

.EXAMPLE
  # Basic認証もかける場合
  .\tools\setup-2-deploy.ps1 -DashboardUser kohei -DashboardPassword "強めのパスワード"
#>
[CmdletBinding()]
param(
  [string]$Ga4PropertyId = "506324594",
  [string]$ProjectName = "nensyuagent-dashboard",
  [string]$KeyDir = (Join-Path $env:USERPROFILE ".nensyuagent"),
  [string]$DashboardUser,
  [string]$DashboardPassword,
  # YouTube非公開指標（任意）。3つそろったときだけ登録する
  [string]$YoutubeClientId,
  [string]$YoutubeClientSecret,
  [string]$YoutubeRefreshToken
)

$ErrorActionPreference = "Stop"

function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "    OK  $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "    !   $msg" -ForegroundColor Yellow }

# ---------- 事前チェック ----------
Step "事前チェック"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
  throw "npx が見つかりません。Node.js をインストールしてください。"
}
Ok "npx あり"

# このスクリプトは tools/ にあるので、ダッシュボードは ../youtube-dashboard
$repoRoot = Split-Path -Parent $PSScriptRoot
$appDir = Join-Path $repoRoot "youtube-dashboard"
if (-not (Test-Path (Join-Path $appDir "index.html"))) {
  throw "ダッシュボードが見つかりません: $appDir （リポジトリのルートから実行してください）"
}
Ok "アプリ: $appDir"

$statePath = Join-Path $KeyDir "setup-state.json"
if (-not (Test-Path $statePath)) {
  throw "状態ファイルがありません: $statePath`n先に .\tools\setup-1-gcloud.ps1 を実行してください。"
}
$state = Get-Content $statePath -Raw | ConvertFrom-Json
if (-not (Test-Path $state.keyFile)) {
  throw "サービスアカウントの鍵が見つかりません: $($state.keyFile)"
}
Ok "サービスアカウント: $($state.serviceAccountEmail)"

# ---------- 初回デプロイ ----------
Step "Vercelへデプロイ（初回）"

Push-Location $appDir
try {
  Write-Host "    ブラウザでのログインを求められたら承認してください。"
  # プロジェクトが未リンクなら対話で作成される。--yes で既定値を採用する。
  npx --yes vercel@latest deploy --prod --yes
  if ($LASTEXITCODE -ne 0) { throw "デプロイに失敗しました。上のログを確認してください。" }
  Ok "デプロイしました"
} finally {
  Pop-Location
}

# ---------- 環境変数 ----------
Step "環境変数の登録"

# JSONは改行を含むため、base64にして1行で渡す（サーバー側で自動判別する）
$saB64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($state.keyFile))

$vars = [ordered]@{
  "GA4_PROPERTY_ID"             = $Ga4PropertyId
  "GOOGLE_SERVICE_ACCOUNT_JSON" = $saB64
  "YOUTUBE_API_KEY"             = $state.apiKey
}
if ($DashboardUser -and $DashboardPassword) {
  $vars["DASHBOARD_USER"] = $DashboardUser
  $vars["DASHBOARD_PASSWORD"] = $DashboardPassword
} else {
  Warn "DashboardUser / DashboardPassword が未指定です。誰でもURLから数値を読める状態になります。"
  Warn "後から設定するか、Vercel の Settings → Deployment Protection を有効にしてください。"
}

# YouTube非公開指標は3つそろったときだけ
if ($YoutubeClientId -and $YoutubeClientSecret -and $YoutubeRefreshToken) {
  $vars["YOUTUBE_CLIENT_ID"]     = $YoutubeClientId
  $vars["YOUTUBE_CLIENT_SECRET"] = $YoutubeClientSecret
  $vars["YOUTUBE_REFRESH_TOKEN"] = $YoutubeRefreshToken
} else {
  Warn "YouTubeのOAuth情報が未指定です。インプレッション・CTR・視聴維持率は表示されません。"
  Warn "後から tools/get_youtube_refresh_token.py を実行し、このスクリプトを再実行すれば追加できます。"
}

Push-Location $appDir
try {
  foreach ($name in $vars.Keys) {
    # 既存があると add が失敗するので、先に消してから入れる（べき等にする）
    npx --yes vercel@latest env rm $name production --yes 2>$null | Out-Null
    $vars[$name] | npx --yes vercel@latest env add $name production | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "$name の登録に失敗しました。" }
    Ok $name   # 値は表示しない
  }
} finally {
  Pop-Location
}

# ---------- 反映 ----------
Step "環境変数を反映するため再デプロイ"

Push-Location $appDir
try {
  npx --yes vercel@latest deploy --prod --yes
  if ($LASTEXITCODE -ne 0) { throw "再デプロイに失敗しました。" }
  Ok "反映しました"
} finally {
  Pop-Location
}

# ---------- 後始末と案内 ----------
Write-Host @"

================================================================
 デプロイ完了
================================================================

上に表示されたURLを開いて確認してください。

  YouTube分析        … 公開指標のみ（OAuth未設定の場合）
  サイト送客・CV     … GA4を /nensyuagent/ に絞り込み済み

Basic認証をかけた場合は、画面の「認証する」ボタンを一度押してから
再読み込みしてください。

【権限エラーが出たら】
  GA4のエラー   → プロパティ列のアクセス管理に $($state.serviceAccountEmail) を
                   「閲覧者」で追加したか確認
【後始末】
  Vercelに登録できたので、手元の鍵はもう不要です：
      Remove-Item "$($state.keyFile)"
      Remove-Item "$statePath"
  ※ setup-state.json にはAPIキーが入っています。消してください。

"@ -ForegroundColor White
