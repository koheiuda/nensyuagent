# 年収エージェント マーケティング支援プロジェクト

## このプロジェクトについて
「年収エージェント」のマーケティング支援を行う**独立したプロジェクト**。
StockSun本体のSEOプロジェクト（`../stocksun`）とはドメインを共有しているが、
KPI・体制・レポートラインが異なるため、**別プロジェクトとして管理する**。

- 対象サービス：https://stock-sun.com/nensyuagent/
- ドメイン：stock-sun.com（StockSun本体と同一）
- 支援領域：SEO / LP改善 / YouTube（2026-08 追加）。広告は要確定
- YouTubeチャンネル：`UCwrivK-bKlDu6ZJzC01GPBw`（アナリティクス権限あり）

## StockSun本体（../stocksun）との関係
| 項目 | 本プロジェクト | ../stocksun |
|---|---|---|
| 対象 | /nensyuagent/ 配下 | /column/ 配下の記事 |
| KPI | 未確定（キックオフで決定） | 本体側の管理シート参照（本リポジトリには記載しない） |
| 管理シート | 未作成 | 月次全体管理シートあり |
| ダッシュボード | なし | dashboard/（Vercel） |

**同じドメインなので、次の点は必ず本体側と突き合わせる。**
- カニバリ：`/column/` の記事と `/nensyuagent/` が同一キーワードで競合していないか
- 計測：GA4・GSCが同一プロパティのため、レポートでは必ずパスで絞り込む
- 送客：`/column/annual-income-agent-reputation/`（「年収エージェント 評判」1位）からの内部リンク導線

数値を本体のシートやダッシュボードに書き戻さないこと。逆も同じ。

## YouTube マーケ
チャンネル `UCwrivK-bKlDu6ZJzC01GPBw` の運用支援も本プロジェクトで扱う。

- 設計の前提は `docs/YouTube_運用設計.md` に集約する（指標定義・優先順位づけ・未確定事項）
- YouTube Analytics のエクスポートは `data/youtube/` 配下
- 取得スクリプトは `tools/youtube_analytics_export.py`（OAuth情報はリポジトリ外・環境変数で指定）
- 定例レポートは `docs/YouTube定例レポート_テンプレート.md` を複製して作成
- 「再生数が伸びた」で終わらせない。必ず送客（`/nensyuagent/` へのセッション・CV）まで接続して評価する
- GA4 は本体と同一プロパティのため、YouTube経由の評価では必ず `/nensyuagent/` でパス絞り込みを行う
- 概要欄・終了画面のリンクは UTM 付きで統一し、動画IDとの対応は `data/youtube/utm_mapping.csv` で管理する
- 分析ダッシュボードは `youtube-dashboard/`（Vercel・ビルド不要・依存ゼロ）。YouTube Data API / YouTube Analytics API / GA4 Data API を直接叩く
- 認証情報（APIキー・OAuthトークン・サービスアカウントJSON）は Vercel の環境変数のみに置き、リポジトリにも会話にも絶対に置かない
- GA4 は本体と同一プロパティのため、API側で `pagePath` を `/nensyuagent/` に絞り込む（`api/ga4.js`）
- GA4プロパティID：506324594
- YouTube分析ダッシュボードはYouTube Analyticsを主画面、GA4の送客・CVを補助画面とする。Search Consoleは載せない

## 出力ルール
- CSV・TSV・JSON → `data/`
- レポート・議事録・指示書（.md） → `docs/`
- スクリプト → `tools/`
- ファイル名の日付は YYYYMMDD 形式（例：`定例レポート_20260901.md`）
- 日本語ファイル名OK

## 分析・提案の方針
- 数字は必ず出典（GA4 / GSC / Ahrefs / 広告管理画面 / チャットワーク共有資料）を明記する
- 未取得の数値を推定で埋めない。不明な場合は「要取得」と明示する
- 施策は「インパクト × 実行コスト」で優先順位を付けて提示する

## 公開リポジトリにつき注意
本リポジトリは Public。以下は**書かないこと**。
- StockSun本体・クライアントの社内KPI実数、売上・単価・原価
- 個人情報、リード実データ、問い合わせ内容
- APIキー・トークン・アカウント認証情報（YouTube API の client_secret / token を含む）
- YouTubeの収益額・広告単価・出演者の報酬
これらが必要な場合は Private リポジトリか社内シートで管理し、本リポジトリからは参照のみとする。
