# 年収エージェント アナリティクス

YouTube と GA4 を **API で直接取得**するダッシュボード。CSVの手動アップロードは廃止済み。

**ビルド不要・依存パッケージゼロ**（静的HTML + Vercel Serverless Function）。
`npm install` も `npm run build` も要りません。JWT署名も Node 標準の `crypto` で自前実装しています。

## API連携の構成

| エンドポイント | API | 認証方式 | 取れるもの |
|---|---|---|---|
| `/api/youtube` | YouTube Data API v3 | APIキー | 登録者数・総再生回数・動画一覧・累計再生数 |
| `/api/youtube-analytics` | YouTube Analytics API v2 | **OAuth リフレッシュトークン** | インプレッション・CTR・視聴維持率・平均視聴時間・登録者増減・トラフィックソース |
| `/api/ga4` | GA4 Data API v1beta | **サービスアカウント** | `/nensyuagent/` のセッション・CV・参照元・ページ別・YouTube経由の送客 |

認証方式が3つに分かれるのは仕様上の制約です。
**YouTube Analytics はサービスアカウントを受け付けません**（チャンネル所有者本人の同意が必要）。
一方 GA4 はサービスアカウントで動くので、そちらは無人で回せます。

すべての認証情報は**サーバー側のみ**で使い、ブラウザには一切返しません。
エラー時もリクエストURLは返さない実装です（URLに鍵が乗るため）。

## 環境変数（Vercel のプロジェクト設定で登録）

| 変数 | 用途 | 必須 |
|---|---|---|
| `YOUTUBE_API_KEY` | YouTube Data API v3 | 公開指標に必要 |
| `YOUTUBE_CHANNEL_ID` | 対象チャンネル。既定 `UCwrivK-bKlDu6ZJzC01GPBw` | 任意 |
| `YOUTUBE_CLIENT_ID` | OAuthクライアントID | 非公開指標に必要 |
| `YOUTUBE_CLIENT_SECRET` | OAuthクライアントシークレット | 非公開指標に必要 |
| `YOUTUBE_REFRESH_TOKEN` | リフレッシュトークン（下記手順で発行） | 非公開指標に必要 |
| `GA4_PROPERTY_ID` | `506324594` | GA4に必要 |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | サービスアカウントJSON全文（base64も可） | GA4に必要 |
| `DASHBOARD_USER` / `DASHBOARD_PASSWORD` | APIのBasic認証。**両方設定したときだけ**有効 | 強く推奨 |

**リポジトリには絶対に置かないでください**（本リポジトリは Public）。
一部だけ設定した状態でも動きます。未設定の機能は画面に設定手順が出ます。

## アクセス制限（設定を強く推奨）

デプロイURLは推測されにくいだけで、公開されています。**何も設定しないと、URLを知った人は
誰でもチャンネルの数値とGA4のCV数を読めます。** どちらかを必ず設定してください。

**方法1：Vercel Deployment Protection（推奨）**
Vercel → プロジェクト → Settings → Deployment Protection を有効化。
ページ本体ごと保護され、Vercelアカウントでのログインが必要になります。

**方法2：Basic認証**
環境変数 `DASHBOARD_USER` と `DASHBOARD_PASSWORD` を設定すると、
APIエンドポイントがBasic認証で保護されます（両方設定したときだけ有効）。
HTMLは静的なので誰でも開けますが、**データはAPI経由でしか出ないため実質的に保護されます**。

> ブラウザは `fetch` の 401 では認証ダイアログを出さないことがあるため、
> 画面に「認証する」ボタンを用意しています。押すとAPIのURLが新しいタブで開き、
> そこで認証すれば以降は通常どおり表示されます。

パスワード比較は定数時間で行い、長さの違いでも例外にならないようハッシュに揃えて比較しています。

## セットアップ

### 1. YouTube 公開指標（APIキー）
1. Google Cloud → APIとサービス → ライブラリ → **YouTube Data API v3** を有効化
2. 認証情報 → APIキーを作成（キーの制限で YouTube Data API v3 のみに限定推奨）
3. `YOUTUBE_API_KEY` に設定

### 2. YouTube 非公開指標（OAuth）
1. Google Cloud → **YouTube Analytics API** を有効化
2. 認証情報 → OAuthクライアントID → 種類「**デスクトップアプリ**」を作成
3. ローカルで一度だけ実行する:
   ```bash
   export YOUTUBE_CLIENT_ID='...apps.googleusercontent.com'
   export YOUTUBE_CLIENT_SECRET='GOCSPX-...'
   python tools/get_youtube_refresh_token.py
   ```
   ブラウザが開くので、**チャンネルの権限を持つアカウント**で承認
4. 表示された `YOUTUBE_REFRESH_TOKEN` を環境変数に設定

### 3. GA4（サービスアカウント）
1. Google Cloud → IAMと管理 → サービスアカウントを作成 → JSONキーを発行
2. Google Cloud → **Google Analytics Data API** を有効化
3. GA4 → 管理 → プロパティのアクセス管理 → サービスアカウントのメールアドレス
   （`...@....iam.gserviceaccount.com`）を **「閲覧者」** で追加
4. `GA4_PROPERTY_ID=506324594` と `GOOGLE_SERVICE_ACCOUNT_JSON`（JSON全文）を設定

> JSON全文を1行に貼るのが面倒な場合は base64 でも受け付けます:
> `base64 -w0 service-account.json`

## デプロイ

### 方法A：GitHub連携（推奨）
1. Vercel → Add New → Project → `koheiuda/nensyuagent` をインポート
2. **Root Directory を `youtube-dashboard`** に設定
3. Framework Preset は `Other`。Build Command / Output Directory は**空のまま**
4. 環境変数を登録して Deploy

> 本番ブランチは既定で `main` です。フィーチャーブランチの内容を出す場合は
> PR経由で `main` にマージするか、Vercel の Production Branch を変更してください。

### 方法B：Vercel CLI
```bash
cd youtube-dashboard
npx vercel --prod
```

## 画面

| タブ | 内容 |
|---|---|
| YouTube | 登録者数・視聴回数・登録者純増・インプレッションCTR・平均視聴維持率・総再生時間のタイル／視聴回数の推移／トラフィックソース／視聴回数トップ10／動画別テーブル（公開データと非公開指標を動画IDで突き合わせ） |
| 送客（GA4） | セッション・ユーザー・PV・CV・**YouTube経由セッション/CV**のタイル／セッション推移／YouTube経由セッション推移／参照元別／ページ別 |

期間は 28 / 90 / 180 / 365 日から選択。45日を超える期間は棒グラフを週次合計に丸めます。

## 評価の前提
再生数の増減だけで判断しないこと。必ず `/nensyuagent/` への送客（GA4のセッション・CV）と
接続して評価します。GA4 は StockSun 本体と同一プロパティのため、
API側で `pagePath` が `/nensyuagent/` で始まるものだけに絞り込んでいます。
詳細は `../docs/YouTube_運用設計.md` を参照。
