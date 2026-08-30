---
name: write-article
description: 対象KWを1本渡すと、SERP調査・構成案コンペ・並列執筆・多角検証・タイトル最適化までをオーケストレーションで実行し、年収エージェント（https://stock-sun.com/nensyuagent/）のSEO記事をWordPress下書きとして納品する。「このKWで記事書いて」「記事作って」「WP下書きまで」と言われたとき、および /write-article 実行時に使う。
---

# 記事執筆〜WP下書き納品

対象KWを受け取り、**1位獲得 × セッション最大化 × CTR最大化 × CVR最大化**を満たす記事を
WordPressの下書きとして納品するまでを一気通貫で実行する。

## 引数

```
/write-article <対象KW> [補足指示]
```

例：`/write-article 転職エージェント 担当者 変更`
例：`/write-article キャリアアドバイザー 合わない CTAはLINE訴求で`

KWが渡されなかった場合のみ、`data/KW候補_*.tsv` から未着手の最上位KWを提案し、確認を取る。

---

## Step 0：前提の読み込み（必ず最初に）

以下をすべて読む。読まずに書き始めない。

1. `docs/執筆フロー_年収エージェント_20260830.md` … 案件方針
2. `references/レギュレーション.md` … 書いてはいけない表現
3. `references/構成テンプレート.md` … 記事の骨格
4. `references/文体ルール.md` … 文体・表記
5. `data/KW候補_*.tsv` … KWの位置づけとカニバリ判定
6. `docs/articles/` の既存記事 … 重複回避と内部リンク候補の把握

### 環境の既知の制約（毎回確認する）
- `stock-sun.com` はネットワークegressでブロックされることがある。`WebFetch` が
  `EGRESS_BLOCKED` を返したら、**WebSearch経由の間接情報**に切り替え、
  取得できなかった事実は本文に書かず「要確認」として入稿指示書に起票する。
- Ahrefs は API ユニット切れになることがある。`API units limit reached` が出たら
  検索Vol・KDは **「要取得」** と明記する。**推定値で埋めることは禁止**。

---

## Step 1：オーケストレーション実行

`Workflow` ツールを `{ name: "write-article", args: {...} }` で起動する。
このスキルの実行自体がワークフロー利用のオプトインなので、ユーザーに追加の許可は求めない。

```
args = {
  keyword:  "<対象KW>",
  service:  "年収エージェント",
  lp:       "/nensyuagent/",
  usp:      "担当キャリアアドバイザーを自分で選べる／年収チャンネル発の独自求人",
  related:  ["/column/annual-income-agent-reputation/"],
  notes:    "<ユーザーの補足指示。無ければ空文字>",
  date:     "<今日の日付 YYYY-MM-DD。スクリプト内で日付は取得できないので必ず渡す>"
}
```

ワークフローが返すもの：

| キー | 内容 |
|---|---|
| `recon` | SERP分析・検索意図・カニバリ判定・USP整合・KWデータ |
| `outline` | 構成案コンペの勝者（採点表と敗者の良かった点の移植込み） |
| `bodyHtml` | 検証・修正を通過した本文HTML |
| `title` / `metaDescription` / `slug` / `titleAlternatives` | CTR最適化済み |
| `faq` | FAQ構造化データ用のQ&A |
| `openIssues` | 未取得・要確認として残った項目 |

**ワークフローが落ちた場合**：`runId` を控え、`Workflow({scriptPath, resumeFromRunId})` で再開する。
最初からやり直さない。

---

## Step 2：成果物のファイル出力

プロジェクト規約（`CLAUDE.md`）に従って配置する。

| 出力 | パス |
|---|---|
| 本文HTML | `docs/articles/<記事名>_本文_<YYYYMMDD>.html` |
| 入稿指示書 | `docs/WP入稿指示書_<記事名>_<YYYYMMDD>.md` |
| KWデータ | `data/` （更新があれば） |

入稿指示書には必ず含める：
- KW選定根拠（なぜ勝てるか、なぜカニバらないか）
- タイトル案A/B/Cと採用理由
- メタディスクリプション（全角120字前後）
- FAQ構造化データの対象設問
- 内部リンク表（**`/column/` 側への被リンク依頼は本体 `../stocksun` への依頼事項として明記**）
- UTM付きCTA一覧と計測設定
- **公開前チェックリスト**：`openIssues` を1項目1チェックボックスで転記

---

## Step 3：WordPress 下書き納品

```bash
python3 tools/wp_draft.py \
  --html   docs/articles/<記事名>_本文_<YYYYMMDD>.html \
  --title  "<タイトル>" \
  --slug   "<スラッグ>" \
  --meta   "<メタディスクリプション>" \
  --status draft
```

- 認証は `.env`（gitignore済み）の `WP_URL` / `WP_USER` / `WP_APP_PASSWORD` から読む
- **`--status draft` 以外は使わない。** 公開はクライアント承認後に人間が行う
- 認証情報が無ければスクリプトが手順を出して停止する。
  その場合は**入稿指示書と本文HTMLまでを納品物として提示し、WP入稿が未実施であることを明示する**

投稿後：
1. 返ってきた下書きURLを控える
2. スマホ幅で `<pre>` の例文・表の折返し・CTAボタンを目視確認する
3. `noindex` が付いていないことを確認する

---

## Step 4：コミット & 報告

1. 指定ブランチにコミット & push
2. ユーザーへの報告に必ず含める：
   - 対象KWと**なぜそのKWで勝てるのか**（SERPのどこに空白があったか）
   - 差別化の芯（USPがどう解になっているか）
   - WP下書きURL、または未入稿である事実と理由
   - `openIssues`（要確認・要取得）の一覧

---

## やってはいけないこと

- 出典のない数値を本文に書く
- 「必ず」「100%」など断定的な効果保証
- 他社転職エージェントの誹謗・優劣評価
- `/column/` 配下の記事を直接編集する（本体SEOの管理領域。依頼事項として起票する）
- 指名KW「年収エージェント 評判」を新規記事で狙う（既存記事が1位。カニバる）
- WPへ `publish` で投稿する
- 検証フェーズの指摘を握りつぶして「完了」と報告する
