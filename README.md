# 年収エージェント マーケティング支援

StockSun本体のSEOプロジェクト（`../stocksun`）とは**別プロジェクト**。
ドメインは同じ stock-sun.com だが、案件として独立して管理する。

## 基本情報
| 項目 | 内容 |
|---|---|
| 対象サービス | 年収エージェント |
| サービスURL | https://stock-sun.com/nensyuagent/ |
| 開始 | 2026-08 |
| 支援領域 | SEO / LP改善 / YouTube（2026-08 追加）／広告は要確定 |

## YouTube
| 項目 | 内容 |
|---|---|
| チャンネルID | `UCwrivK-bKlDu6ZJzC01GPBw` |
| チャンネルURL | https://www.youtube.com/channel/UCwrivK-bKlDu6ZJzC01GPBw |
| アナリティクス権限 | 担当者アカウントに付与済み（2026-08-30。権限レベルは要確認） |
| 管理シート | https://docs.google.com/spreadsheets/d/1lzxCOEannP-2jyWei2dSbFplO2ViD6k87zsLutvZh7s/edit?gid=23164176#gid=23164176 |

- 運用設計：`docs/YouTube_運用設計.md`
- ヒアリング項目：`docs/YouTube_キックオフ_ヒアリング項目.md`
- 定例レポート雛形：`docs/YouTube定例レポート_テンプレート.md`
- データ取得スクリプト：`tools/youtube_analytics_export.py`

## チャットワーク
| ルーム | URL | 用途 |
|---|---|---|
| rid360517564 | https://www.chatwork.com/#!rid360517564 | 要確認 |
| rid434302633 | https://www.chatwork.com/#!rid434302633 | 要確認 |
| rid425512702 | https://www.chatwork.com/#!rid425512702 | 要確認 |

## 関連する既存アセット（StockSunコラム側）
- `年収エージェント 評判` … https://stock-sun.com/column/annual-income-agent-reputation/
  - 検索ボリューム 90 / 直近順位 1位 / 分類：その他・know
  - サービスページへの送客導線として最有力。内部リンク・CTAの見直し余地あり。
  - ※ 記事自体の管理は `../stocksun` 側。本プロジェクトでは送客導線の観点でのみ扱う。

## ディレクトリ構成
| フォルダ | 内容 |
|---|---|
| `data/` | CSV・TSV・JSON等のデータファイル |
| `data/youtube/` | YouTube Analytics のエクスポート、UTM対応表 |
| `docs/` | レポート・議事録・指示書・分析メモ |
| `tools/` | 取得・集計スクリプト |

## 未確定事項（キックオフで確認）
- KPI（セッション / CV / リード / 受注）と目標値、計測期間
- CVの定義（フォーム送信 / 面談予約 / 電話 など）と計測環境（GA4・GSC・広告アカウントの権限）
- 競合（他の転職エージェント）と差別化ポイント
- 予算・工数・レポーティング頻度
- 既存の広告アカウント／SNSアカウントの有無
- YouTube の支援スコープ（企画／台本／撮影／編集／分析のどこまで）と体制
- 管理シートの共有範囲（現状、Claude 側の接続アカウントからは開けない）

詳細は `docs/キックオフ_ヒアリング項目.md` を参照。
