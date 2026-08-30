# YouTube 分析ダッシュボード

年収エージェントチャンネル（`UCwrivK-bKlDu6ZJzC01GPBw`）の分析ダッシュボード。

**ビルド不要・依存パッケージゼロ**（静的HTML + Vercel Serverless Function 1本）。
`npm install` も `npm run build` も要りません。

## 構成
| ファイル | 役割 |
|---|---|
| `index.html` | ダッシュボード本体（バニラJS、チャートは自前のHTML/CSS） |
| `api/youtube.js` | YouTube Data API v3 のプロキシ。APIキーはサーバー側のみで保持 |

## 2つのモード

### 1. ライブ（公開指標）— `YOUTUBE_API_KEY` が必要
YouTube Data API v3 から取得できる**公開指標**を表示します。

- 登録者数 / チャンネル総再生回数 / 公開動画数 / 1本あたり平均再生回数
- 月別 再生回数（公開月ベースの棒グラフ）
- 再生回数 トップ10
- エンゲージメント率 トップ10（(高評価＋コメント)÷再生回数、再生100回未満は除外）
- 全動画テーブル（列見出しクリックで並べ替え）

### 2. CSV分析（YouTube Studio エクスポート）— 設定不要
インプレッション・CTR・視聴維持率など、**Data API では取れない非公開指標**を扱えます。

YouTube Studio → アナリティクス → 詳細モード → エクスポート → カンマ区切り（.csv）

- ファイルはブラウザ内だけで処理され、サーバーへ送信されません
- 「合計」行は自動で除外（グラフが合計値に支配されるのを防ぐため）
- `3:12` のような時間表記は秒に換算して集計し、表示は時間表記に戻します

## 環境変数（Vercel のプロジェクト設定で登録）
| 変数 | 必須 | 内容 |
|---|---|---|
| `YOUTUBE_API_KEY` | ○ | Google Cloud で発行した YouTube Data API v3 のAPIキー |
| `YOUTUBE_CHANNEL_ID` | — | 対象チャンネル。既定は `UCwrivK-bKlDu6ZJzC01GPBw` |

APIキーは **サーバー側でのみ** 使用し、ブラウザには一切返しません。
**リポジトリには絶対にコミットしないでください**（本リポジトリは Public です）。

APIキーの発行手順：Google Cloud コンソール → APIとサービス → ライブラリ →
「YouTube Data API v3」を有効化 → 認証情報 → APIキーを作成 →
（推奨）キーの制限で「YouTube Data API v3」のみに限定。

## デプロイ

### 方法A：GitHub連携（推奨・push で自動デプロイ）
1. Vercel → Add New → Project → `koheiuda/nensyuagent` をインポート
2. **Root Directory を `youtube-dashboard` に設定**
3. Framework Preset は `Other`。Build Command / Output Directory は**空のまま**
4. Environment Variables に `YOUTUBE_API_KEY` を追加
5. Deploy

> 本番ブランチは既定で `main` です。フィーチャーブランチの内容を本番に出す場合は
> PR経由で `main` にマージするか、Vercel の Production Branch 設定を変更してください。

### 方法B：Vercel CLI
```bash
cd youtube-dashboard
vercel --prod
```

## ローカルで動かす
```bash
cd youtube-dashboard
vercel dev          # /api/youtube を動かすには vercel dev が必要
```
CSV分析タブだけなら、`index.html` をブラウザで直接開くだけでも動きます。

## 評価の前提
再生数の増減だけで判断しないこと。必ず `/nensyuagent/` への送客（GA4のセッション・CV）と
接続して評価します。GA4・GSC は StockSun 本体と同一プロパティのため、
**必ずパスで絞り込む**こと。詳細は `../docs/YouTube_運用設計.md` を参照。
