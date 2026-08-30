# 年収エージェント YouTube 運用設計

作成日：2026-08-30
対象チャンネル：`UCwrivK-bKlDu6ZJzC01GPBw`
チャンネルURL：https://www.youtube.com/channel/UCwrivK-bKlDu6ZJzC01GPBw

> 本ドキュメントは「何を、どの指標で、どう判断するか」の枠組みのみを定義する。
> 数値は YouTube Analytics / 管理シートから取得して埋めること。**推定値で埋めない。**

## 0. 前提（2026-08-30 時点）
| 項目 | 状態 |
|---|---|
| YouTube アナリティクス権限 | 担当者アカウントに付与済み（権限レベルは要確認：閲覧のみ／編集） |
| 管理シート | https://docs.google.com/spreadsheets/d/1lzxCOEannP-2jyWei2dSbFplO2ViD6k87zsLutvZh7s/edit?gid=23164176#gid=23164176 （※Claude 側の接続アカウントからは未参照。共有設定の確認が必要） |
| チャンネル基本情報（登録者数・動画本数・投稿頻度） | 要取得 |
| 支援スコープ（企画／台本／撮影／編集／分析のどこまで） | 要確定 |
| 既存の運用体制（誰が企画・撮影・編集・投稿しているか） | 要確定 |

## 1. YouTube を何のためにやるか（ゴール定義）
「再生数」は目的ではなく手段。先に下記のどれが主目的かを確定させる。

| ゴール類型 | 主KPI | 補助指標 | 想定コンテンツ |
|---|---|---|---|
| A. 直接送客（面談・申込） | YouTube 経由CV数 / CPA | 概要欄クリック率、LP到達率 | サービス紹介、事例、Q&A |
| B. 指名検索の創出 | 「年収エージェント」指名検索数 | ブランド検索の月次推移（GSC） | 出演者の人格が立つ企画 |
| C. 母集団形成（登録者） | チャンネル登録者純増 | impression CTR、平均視聴維持率 | 汎用的な転職ノウハウ |
| D. 信頼補完（比較検討の後押し） | LP内での動画視聴率 | 視聴後CVR | 導入事例、料金説明 |

→ 現時点の第一候補は **A + B**（既に `/nensyuagent/` という受け皿と「年収エージェント 評判」1位記事があるため）。
　キックオフで確定させる。

## 2. 指標定義（レポートで必ずこの定義を使う）
| 指標 | 定義 | 取得元 |
|---|---|---|
| インプレッション | YouTube 上でサムネイルが表示された回数 | YouTube Analytics（`impressions`） |
| インプレッションCTR | 視聴回数 ÷ インプレッション | YouTube Analytics（`impressionsClickThroughRate`） |
| 視聴回数 | `views` | YouTube Analytics |
| 総再生時間 | `estimatedMinutesWatched`（分） | YouTube Analytics |
| 平均視聴時間 | `averageViewDuration`（秒） | YouTube Analytics |
| 平均視聴維持率 | `averageViewPercentage`（%） | YouTube Analytics |
| 登録者純増 | `subscribersGained - subscribersLost` | YouTube Analytics |
| トラフィックソース | 検索／ブラウジング／関連動画／外部 の内訳 | YouTube Analytics（`insightTrafficSourceType`） |
| YouTube 経由セッション | GA4 セッションのうち参照元 youtube.com、またはUTM付きリンク | GA4（パスを `/nensyuagent/` で絞る） |
| YouTube 経由CV | 上記セッションのCV（CV定義は本体キックオフで確定） | GA4 |

**注意：GA4・GSC は StockSun 本体と同一プロパティ。レポートでは必ず `/nensyuagent/` でパス絞り込みを行う。**

## 3. 計測導線（先に整えるべきもの）
1. 概要欄・固定コメント・終了画面のリンクを **UTM 付きに統一する**
   - 例：`https://stock-sun.com/nensyuagent/?utm_source=youtube&utm_medium=social&utm_campaign=<動画スラッグ>`
   - `utm_campaign` は動画ごとに変える（どの動画が送客しているか分離するため）
2. GA4 で「YouTube 経由」の探索レポートを1つ作る（パス絞り込み込み）
3. 動画ID ↔ UTM値 の対応表を `data/youtube/utm_mapping.csv` に持つ
4. 指名検索の推移を GSC でモニタ（「年収エージェント」等のクエリ、`/nensyuagent/` ページ）

## 4. 分析の初期タスク（順番どおりに実施）
| # | タスク | 出力先 | 目的 |
|---|---|---|---|
| 1 | チャンネル全体の月次推移を12ヶ月分エクスポート | `data/youtube/channel_daily_*.csv` | 伸びているのか止まっているのかを確認 |
| 2 | 動画別パフォーマンス（全動画） | `data/youtube/video_performance_*.csv` | 勝ち筋（テーマ×形式）の特定 |
| 3 | トラフィックソース内訳 | `data/youtube/traffic_source_*.csv` | 検索需要型かブラウジング型かの判定 |
| 4 | 上位動画の視聴維持率カーブ確認 | `docs/YouTube_動画別分析_YYYYMMDD.md` | 冒頭離脱・中盤離脱の把握 |
| 5 | 競合チャンネル調査（転職エージェント系） | `docs/YouTube_競合調査_YYYYMMDD.md` | 空いているテーマの発見 |
| 6 | 概要欄・終了画面・固定コメントの導線監査 | `docs/YouTube_導線監査_YYYYMMDD.md` | 送客ロスの回収（最も低コスト） |

## 5. 施策の優先順位づけ
CLAUDE.md の方針どおり「インパクト × 実行コスト」で並べる。初期は**既存資産の回収から**。

| 優先 | 施策 | インパクト | コスト | 備考 |
|---|---|---|---|---|
| 高 | 既存動画の概要欄・終了画面・固定コメントのCTA/UTM統一 | 中 | 低 | 撮り直し不要、当日着手可 |
| 高 | 上位動画のサムネ・タイトル改善（CTR起点） | 高 | 低 | 効果検証しやすい |
| 中 | `/nensyuagent/` LP・評判記事への動画埋め込み | 中 | 低 | 動画の再利用、滞在時間にも寄与 |
| 中 | 勝ち筋テーマの横展開（シリーズ化） | 高 | 中 | データ確認後に決定 |
| 中 | ショート活用による認知拡大 | 中 | 中 | 登録者導線としてのみ評価する |
| 低 | 新規フォーマットの実験 | 不明 | 高 | 上記が回ってから |

※ 各行の「インパクト」は現時点の仮置き。#4 の初期分析で数値を入れてから確定する。

## 6. レポーティング
- 頻度：月次（定例に合わせる。要確定）
- 出力：`docs/YouTube定例レポート_YYYYMMDD.md`（テンプレート：`docs/YouTube定例レポート_テンプレート.md`）
- 数値の出典を必ず併記（YouTube Analytics / GA4 / GSC / 管理シート）
- 本体（`../stocksun`）のシート・ダッシュボードには書き戻さない

## 7. 未確定事項
- チャンネルの投稿方針・過去の意思決定の経緯（なぜ今の形式なのか）
- 撮影・編集リソース（内製／外注、月あたり本数の上限）
- 出演者と、出演可能な頻度
- YouTube 広告（TrueView）出稿の有無・予算
- 管理シートの各タブの用途と、どこを更新してよいか
