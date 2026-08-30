# 年収エージェント マーケティング支援

StockSun本体のSEOプロジェクト（`../stocksun`）とは**別プロジェクト**。
ドメインは同じ stock-sun.com だが、案件として独立して管理する。

## 基本情報
| 項目 | 内容 |
|---|---|
| 対象サービス | 年収エージェント |
| サービスURL | https://stock-sun.com/nensyuagent/ |
| 開始 | 2026-08 |
| 支援領域 | （要確定：SEO / 広告 / LP改善 / SNS など） |

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

## 記事制作の使い方

対象KWを渡すだけで、調査からWordPress下書き入稿までを一気に実行します。

```
/write-article 転職エージェント 担当者 変更
```

内部でオーケストレーション（`.claude/workflows/write-article.js`）が動き、
並列調査 → 構成案コンペ（3案生成・3審査員で採点）→ H2ごとの並列執筆
→ 5観点の監査ループ → タイトルコンペ、の順に処理します。

| ファイル | 役割 |
|---|---|
| `.claude/skills/write-article/SKILL.md` | 実行プロンプト本体 |
| `.claude/skills/write-article/references/` | レギュレーション・構成テンプレート・文体ルール |
| `.claude/workflows/write-article.js` | オーケストレーション定義 |
| `tools/wp_draft.py` | WordPress下書き入稿（REST API） |
| `docs/執筆フロー_年収エージェント_20260830.md` | 人が読む用の方針ドキュメント |

### WordPress接続の設定（初回のみ）

WP管理画面 > ユーザー > プロフィール でアプリケーションパスワードを発行し、
プロジェクトルートに `.env` を作成します（`.gitignore` 済み。**公開リポジトリなので絶対にコミットしない**）。

```
WP_URL=https://stock-sun.com
WP_USER=<WPユーザー名>
WP_APP_PASSWORD=<アプリケーションパスワード>
```

未設定の場合、記事HTMLと入稿指示書までを納品し、WP入稿は未実施として報告します。

## ディレクトリ構成
| フォルダ | 内容 |
|---|---|
| `data/` | CSV・TSV・JSON等のデータファイル |
| `docs/` | レポート・議事録・指示書・分析メモ |
| `tools/` | 取得・集計スクリプト |

## 未確定事項（キックオフで確認）
- KPI（セッション / CV / リード / 受注）と目標値、計測期間
- CVの定義（フォーム送信 / 面談予約 / 電話 など）と計測環境（GA4・GSC・広告アカウントの権限）
- 競合（他の転職エージェント）と差別化ポイント
- 予算・工数・レポーティング頻度
- 既存の広告アカウント／SNSアカウントの有無

詳細は `docs/キックオフ_ヒアリング項目.md` を参照。
