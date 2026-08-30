export const meta = {
  name: 'write-article',
  description: '対象KWからSEO記事を生成（並列調査→構成案コンペ→H2並列執筆→5観点の検証ループ→タイトル最適化）',
  whenToUse: '年収エージェント案件でKWを1本渡し、WP納品品質の記事を作らせるとき',
  phases: [
    { title: '調査', detail: 'SERP・検索意図・カニバリ・USP整合・KWデータを並列取得' },
    { title: '構成案', detail: '差別化軸の異なる構成案を3本生成し、3名の審査員が採点' },
    { title: '執筆', detail: 'H2ごとに並列執筆し、セクション単位で推敲' },
    { title: '統合', detail: '接続・重複除去・文体統一・HTML化' },
    { title: '検証', detail: 'SEO/表現規制/CVR/可読性/網羅性の5観点で指摘し修正' },
    { title: '仕上げ', detail: 'タイトル・メタ・FAQ・残課題の確定' },
  ],
}

const A = args || {}
const KW = A.keyword
const SERVICE = A.service || '年収エージェント'
const LP = A.lp || '/nensyuagent/'
const USP = A.usp || '担当キャリアアドバイザーを自分で選べる'
const RELATED = A.related || []
const NOTES = A.notes || ''
const TODAY = A.date || ''

if (!KW) throw new Error('args.keyword（対象KW）が必要です')

const RULES = `
【案件前提】
- サービス：${SERVICE}（LP: ${LP}）
- USP：${USP}
- 関連既存記事：${RELATED.join(', ') || 'なし'}
- 補足指示：${NOTES || 'なし'}
- 基準日：${TODAY || '未指定'}

【厳守】
- 出典のない数値は書かない。未取得は本文に入れず「要確認」として報告する
- 「必ず」「100%」等の効果保証、他社エージェントの誹謗・優劣評価は禁止
- stock-sun.com は egress ブロックされることがある。WebFetch が EGRESS_BLOCKED を返したら
  WebSearch 経由の間接情報に切り替え、取れなかった事実は「要確認」に回す
- Ahrefs が "API units limit reached" を返したら検索Vol/KDは「要取得」と書く。推定禁止
- リポジトリ内の .claude/skills/write-article/references/ 配下（レギュレーション/構成テンプレート/文体ルール）を
  必ず読んでから作業する
`

// ---------------- schemas ----------------
const S_RECON = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'openIssues'],
}

const S_OUTLINE = {
  type: 'object',
  properties: {
    angle: { type: 'string', description: 'この構成案の差別化軸' },
    rationale: { type: 'string', description: 'なぜ上位を抜けるのか' },
    leadSummary: { type: 'string' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          h2: { type: 'string' },
          purpose: { type: 'string', description: 'このH2が担う役割' },
          h3: { type: 'array', items: { type: 'string' } },
          mustInclude: { type: 'array', items: { type: 'string' }, description: '表・例文・一次情報など必須要素' },
          targetChars: { type: 'integer' },
          cta: { type: 'string', description: 'このH2直後に置くCTA（不要なら空文字）' },
        },
        required: ['h2', 'purpose', 'h3', 'mustInclude', 'targetChars', 'cta'],
      },
    },
  },
  required: ['angle', 'rationale', 'leadSummary', 'sections'],
}

const S_SCORE = {
  type: 'object',
  properties: {
    scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          score: { type: 'integer', description: '0-100' },
          strength: { type: 'string' },
          weakness: { type: 'string' },
        },
        required: ['index', 'score', 'strength', 'weakness'],
      },
    },
    bestIndex: { type: 'integer' },
    graftIdeas: { type: 'array', items: { type: 'string' }, description: '敗者から勝者へ移植すべき要素' },
  },
  required: ['scores', 'bestIndex', 'graftIdeas'],
}

const S_SECTION = {
  type: 'object',
  properties: {
    h2: { type: 'string' },
    html: { type: 'string', description: '<h2>から始まるHTML断片' },
    factsToVerify: { type: 'array', items: { type: 'string' } },
  },
  required: ['h2', 'html', 'factsToVerify'],
}

const S_BODY = {
  type: 'object',
  properties: {
    html: { type: 'string' },
    charCount: { type: 'integer' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['html', 'charCount', 'notes'],
}

const S_AUDIT = {
  type: 'object',
  properties: {
    lens: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', description: 'blocker | major | minor' },
          where: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string', description: '具体的な修正指示' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
  },
  required: ['lens', 'issues'],
}

const S_TITLE = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          chars: { type: 'integer' },
          hook: { type: 'string' },
        },
        required: ['title', 'chars', 'hook'],
      },
    },
  },
  required: ['candidates'],
}

const S_FINAL = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    titleAlternatives: { type: 'array', items: { type: 'string' } },
    metaDescription: { type: 'string' },
    slug: { type: 'string' },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
      },
    },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['title', 'titleAlternatives', 'metaDescription', 'slug', 'faq', 'openIssues'],
}

// ---------------- 1. 調査（バリア：全部揃わないと構成が決められない） ----------------
phase('調査')
log(`対象KW「${KW}」の調査を開始`)

const RECON_TASKS = [
  {
    key: 'serp',
    prompt: `WebSearch を使い「${KW}」の検索結果上位を調べ、次を報告せよ。
1) 上位10本のURL・タイトル・運営元の種別（大手エージェント自社/比較メディア/個人）
2) 各記事のH2構成（取得できた範囲で）
3) 全社が触れている必須論点＝入れないと勝てないトピック
4) SERPタイプ（how-to / 比較 / 定義 / 体験談）
5) 上位10本の誰も書いていない論点＝コンテンツギャップ（最重要）
6) 上位記事の推定文字数レンジ
findings には箇条書きで事実のみ、推測は書かない。`,
  },
  {
    key: 'intent',
    prompt: `「${KW}」で検索する人の検索意図を解体せよ。
1) 顕在ニーズ（この記事で必ず満たすべき答え）
2) 潜在ニーズ（検索者が"次に"困ること）
3) ペルソナ（年代/年収帯/職種/転職検討度/心理状態）
4) 読者が離脱する瞬間と、その手前で置くべき情報
5) 潜在ニーズから「${USP}」へ自然に橋渡しする論理の道筋を1本、具体的な文章で示す
これが記事のCVR設計の芯になる。抽象論ではなく具体で書け。`,
  },
  {
    key: 'canniba',
    prompt: `カニバリと自社アセットを調査せよ。
1) WebSearch で「site:stock-sun.com ${KW}」を調べ、既存記事が同KWを受けていないか確認
2) 特に /column/ 配下（StockSun本体SEOの管理領域）に競合記事がないか
3) 競合していた場合の判断（KWをずらす / 本体側に統合提案）を明示
4) 本記事から張るべき内部リンク先と、逆に本体側へ依頼すべき被リンク設置を列挙
リポジトリの data/KW候補_*.tsv と docs/articles/ も読んで既存の記事資産を把握すること。`,
  },
  {
    key: 'usp',
    prompt: `「${SERVICE}」のサービス事実を、出典付きで集めよ。
WebSearch で stock-sun.com/nensyuagent/ と stock-sun.com/column/annual-income-agent-reputation/ の
内容を調べる（直接のWebFetchは EGRESS_BLOCKED になる可能性が高い。その場合は検索結果のスニペットから拾う）。
1) 確認できたサービス事実（USP・求人数・年収チャンネル・アドバイザーの特徴）を、値＋時点＋出典の3点セットで
2) 「${KW}」の検索者にとって、USPがどう"解"になるかを1段落で
3) 確認が取れなかった項目（料金・相談形式・担当者指名の正確な仕様など）は openIssues へ
裏が取れていない事実を findings に混ぜるな。`,
  },
  {
    key: 'kwdata',
    prompt: `Ahrefs MCP（ToolSearch で読み込む）で「${KW}」および関連KWの
検索ボリューム・KD・関連キーワードを取得せよ。
"API units limit reached" が返った場合は、それ以上リトライせず
findings に「Ahrefs APIユニット不足のため未取得」と書き、openIssues に「検索Vol/KDの取得」を入れよ。
推定値は絶対に書くな。`,
  },
]

const recon = await parallel(
  RECON_TASKS.map((t) => () =>
    agent(`${RULES}\n\n【タスク：${t.key}】\n${t.prompt}`, {
      label: `調査:${t.key}`,
      phase: '調査',
      schema: S_RECON,
    })
  )
)

const reconOk = recon.filter(Boolean)
const reconBrief = RECON_TASKS.map((t, i) => {
  const r = recon[i]
  if (!r) return `### ${t.key}\n(取得失敗)`
  return `### ${t.key}\n${r.summary}\n${r.findings.map((f) => `- ${f}`).join('\n')}`
}).join('\n\n')

const openIssues = reconOk.flatMap((r) => r.openIssues)
log(`調査完了：${reconOk.length}/${RECON_TASKS.length} 件成功、要確認 ${openIssues.length} 件`)

// ---------------- 2. 構成案コンペ（バリア：全案揃わないと採点できない） ----------------
phase('構成案')

const ANGLES = [
  '網羅性で勝つ：上位10本の論点を全部内包したうえで、実用素材（表・テンプレ・チェックリスト）の密度で差をつける',
  '課題の再定義で勝つ：検索者が抱えている問題を一段深く捉え直し、その解としてUSPが立ち上がる構成にする',
  '一次情報で勝つ：年収チャンネル・キャリアアドバイザーの実務知見など、他社が持てない情報を軸に据える',
]

const outlines = await parallel(
  ANGLES.map((angle, i) => () =>
    agent(
      `${RULES}\n\n【調査結果】\n${reconBrief}\n\n` +
        `対象KW「${KW}」の記事構成案を1本作れ。\n` +
        `この案の差別化軸は次で固定する：${angle}\n\n` +
        `.claude/skills/write-article/references/構成テンプレート.md を読み、骨格に従うこと。\n` +
        `ただしテンプレは型であって、KWに合わせて増減してよい。\n` +
        `H2は7〜10本。上位10本の共通論点はすべて内包し、独自H2を2本以上足すこと。\n` +
        `各H2に、狙う共起語・必須要素・目標文字数・CTAの有無を明記せよ。`,
      { label: `構成案${i + 1}`, phase: '構成案', schema: S_OUTLINE }
    )
  )
)

const outlineList = outlines
  .map((o, i) => (o ? `## 案${i}（${o.angle}）\n勝ち筋: ${o.rationale}\n` + o.sections.map((s) => `- ${s.h2}（${s.purpose} / ${s.targetChars}字）\n  ${s.h3.map((x) => '  - ' + x).join('\n')}`).join('\n') : null))
  .filter(Boolean)
  .join('\n\n')

const JUDGES = [
  { name: '検索順位', focus: '本当に1位を取れるか。上位10本に対する優位性、必須論点の網羅、検索意図との一致' },
  { name: 'CVR', focus: 'LPへの送客が起きるか。CTA配置の必然性、USPへの橋渡しの自然さ、広告記事に見えないか' },
  { name: '読者価値', focus: '読者が本当に問題を解決できるか。実用性、離脱しない流れ、読後の行動が明確か' },
]

const judgments = await parallel(
  JUDGES.map((j) => () =>
    agent(
      `${RULES}\n\n【調査結果】\n${reconBrief}\n\n【構成案（0始まりのindex）】\n${outlineList}\n\n` +
        `あなたは「${j.name}」の審査員だ。観点：${j.focus}\n` +
        `各案を0-100で採点し、最良の index と、敗者から勝者へ移植すべき要素を挙げよ。\n` +
        `点差を付けろ。全案同点は禁止。`,
      { label: `審査:${j.name}`, phase: '構成案', schema: S_SCORE }
    )
  )
)

const totals = {}
judgments.filter(Boolean).forEach((j) => j.scores.forEach((s) => { totals[s.index] = (totals[s.index] || 0) + s.score }))
let bestIdx = 0
Object.keys(totals).forEach((k) => { if (totals[k] > (totals[bestIdx] || -1)) bestIdx = Number(k) })
const winner = outlines[bestIdx] || outlines.filter(Boolean)[0]
const grafts = judgments.filter(Boolean).flatMap((j) => j.graftIdeas)
log(`構成案コンペ：案${bestIdx}が勝利（合計${totals[bestIdx]}点）／移植要素${grafts.length}件`)

const outlineBrief = `差別化軸: ${winner.angle}\n勝ち筋: ${winner.rationale}\nリード方針: ${winner.leadSummary}\n` +
  `敗者からの移植要素:\n${grafts.map((g) => `- ${g}`).join('\n')}`

// ---------------- 3. 執筆（pipeline：H2ごとに書く→推敲。バリアなし） ----------------
phase('執筆')
log(`${winner.sections.length}本のH2を並列執筆`)

const sections = await pipeline(
  winner.sections.map((s, i) => ({ s, i })),
  ({ s, i }) =>
    agent(
      `${RULES}\n\n【調査結果】\n${reconBrief}\n\n【採用構成】\n${outlineBrief}\n\n` +
        `【記事全体のH2一覧（重複回避のため）】\n${winner.sections.map((x, n) => `${n}. ${x.h2}`).join('\n')}\n\n` +
        `あなたは第${i}セクション「${s.h2}」だけを書く。\n` +
        `役割: ${s.purpose}\nH3: ${s.h3.join(' / ')}\n必須要素: ${s.mustInclude.join(' / ')}\n目標: ${s.targetChars}字\n` +
        `CTA: ${s.cta || 'なし'}\n\n` +
        `.claude/skills/write-article/references/文体ルール.md と レギュレーション.md を必ず読んでから書け。\n` +
        `<h2>から始まるHTML断片で出力。他セクションの内容は書くな。\n` +
        `H2直下に必ず結論を1文置け。裏が取れていない数値は書かず factsToVerify に回せ。\n` +
        `CTAリンクは <a href="${LP}?utm_source=organic&amp;utm_medium=column&amp;utm_campaign=SLUG&amp;utm_content=cta${i}"> の形式で置け。`,
      { label: `執筆:${s.h2.slice(0, 18)}`, phase: '執筆', schema: S_SECTION }
    ),
  (draft, { s, i }) =>
    draft
      ? agent(
          `${RULES}\n\n次のセクションHTMLを推敲せよ。内容は減らさず、質だけ上げる。\n` +
            `- 1文60字以内に割る／語尾の3連続を崩す／曖昧語を具体に置換\n` +
            `- 「〜と言えるでしょう」等の逃げ表現、AIっぽい定型を排除\n` +
            `- 3段落続いたら表・箇条書き・囲みを挟む\n` +
            `- 効果保証・他社批判・出典なし数値がないか最終確認\n\n` +
            `【対象（第${i}セクション: ${s.h2}）】\n${draft.html}`,
          { label: `推敲:${s.h2.slice(0, 18)}`, phase: '執筆', schema: S_SECTION }
        )
      : null
)

const sectionHtml = sections.filter(Boolean).map((s) => s.html).join('\n\n')
const factsToVerify = sections.filter(Boolean).flatMap((s) => s.factsToVerify)
log(`執筆完了：${sections.filter(Boolean).length}セクション／要検証ファクト${factsToVerify.length}件`)

// ---------------- 4. 統合 ----------------
phase('統合')

let body = await agent(
  `${RULES}\n\n【採用構成】\n${outlineBrief}\n\n【要検証ファクト】\n${factsToVerify.map((f) => `- ${f}`).join('\n')}\n\n` +
    `以下は別々のエージェントが書いたセクションHTMLを連結したものだ。1本の記事に統合せよ。\n` +
    `1) 冒頭にリード文を追加（結論を3行以内で先出し＋記事で分かることの列挙）\n` +
    `2) セクション間の接続を整え、重複した説明を削る\n` +
    `3) 文体・表記・強調の密度を統一する\n` +
    `4) 記事末に「まとめ」（箇条書き6点前後）と最終CTAを追加\n` +
    `5) 裏の取れていない記述には <!-- <<< 要ファクトチェック：… >>> --> のHTMLコメントを付ける\n` +
    `6) 内部リンクを配置：LP(${LP})へCTA3〜4＋本文中1、関連記事(${RELATED.join(', ')})へ1\n` +
    `出力は本文HTMLのみ（<html>や<body>は不要）。内容量は減らすな。\n\n` +
    `【連結HTML】\n${sectionHtml}`,
  { label: '統合', phase: '統合', schema: S_BODY }
)

// ---------------- 5. 検証ループ（5観点で指摘→修正、収束するまで最大3周） ----------------
phase('検証')

const LENSES = [
  { name: 'SEO', focus: `主KW「${KW}」と共起語の網羅、見出し構造、上位10本に対する優位性、必須論点の欠落、文字数不足` },
  { name: '表現規制', focus: 'レギュレーション違反。効果保証・他社の優劣評価・出典なし数値・個人特定・料金の断定' },
  { name: 'CVR', focus: 'CTAの位置と文言、USPへの橋渡しの自然さ、広告記事に見えていないか、読者の行動が明確か' },
  { name: '可読性', focus: '文体ルール違反、1文の長さ、語尾の連続、AIっぽい定型、文字の壁、スマホでの読みやすさ' },
  { name: '網羅性', focus: '上位10本にあって本記事に無い論点、読者が読後に残す疑問、FAQで拾うべき未回答' },
]

let round = 0
let remaining = []
while (round < 3) {
  round++
  const audits = await parallel(
    LENSES.map((l) => () =>
      agent(
        `${RULES}\n\n【調査結果】\n${reconBrief}\n\n` +
          `あなたは「${l.name}」の観点だけを見る監査役だ。観点：${l.focus}\n` +
          `対象記事を批判的に読み、問題を指摘せよ。severity は blocker/major/minor。\n` +
          `修正案(fix)は「どこをどう直すか」まで具体的に書け。問題がなければ issues を空配列で返せ。\n` +
          `他の観点の問題は指摘するな。\n\n【記事HTML】\n${body.html}`,
        { label: `監査:${l.name}(R${round})`, phase: '検証', schema: S_AUDIT }
      )
    )
  )

  const issues = audits.filter(Boolean).flatMap((a) => a.issues.map((i) => ({ ...i, lens: a.lens })))
  const serious = issues.filter((i) => i.severity === 'blocker' || i.severity === 'major')
  log(`検証R${round}：指摘${issues.length}件（うち要対応${serious.length}件）`)

  if (!serious.length) { remaining = issues; break }

  body = await agent(
    `${RULES}\n\n以下の指摘をすべて反映して記事を修正せよ。\n` +
      `内容量は減らすな。指摘のない箇所は変えるな。相反する指摘があれば読者価値を優先し、notes に判断理由を書け。\n\n` +
      `【指摘】\n${serious.map((i) => `- [${i.lens}/${i.severity}] ${i.where}｜${i.problem}\n  → ${i.fix}`).join('\n')}\n\n` +
      `【記事HTML】\n${body.html}`,
    { label: `修正(R${round})`, phase: '検証', schema: S_BODY }
  )
  remaining = issues.filter((i) => i.severity === 'minor')
}

// ---------------- 6. 仕上げ：タイトルコンペ＋メタ＋FAQ ----------------
phase('仕上げ')

const TITLE_ANGLES = [
  '主KWを左寄せし、検索者の疑問への即答をそのままタイトルにする王道型',
  '感情ワード（角が立たない／損しない／気まずくない）でクリックを取る型',
  '括弧・数字（【例文5つ】等）で視認性を上げる型',
]

const titleSets = await parallel(
  TITLE_ANGLES.map((a, i) => () =>
    agent(
      `${RULES}\n\n【記事の内容】\n${body.html.slice(0, 6000)}\n\n` +
        `対象KW「${KW}」の記事タイトル案を3本作れ。方向性：${a}\n` +
        `全角30〜34字。主KWを必ず含む。根拠のない「No.1」「必ず」は禁止。chars は全角換算の文字数。`,
      { label: `タイトル案${i + 1}`, phase: '仕上げ', schema: S_TITLE }
    )
  )
)

const allTitles = titleSets.filter(Boolean).flatMap((t) => t.candidates)

const final = await agent(
  `${RULES}\n\n【調査結果】\n${reconBrief}\n\n【タイトル候補】\n${allTitles.map((t) => `- ${t.title}（${t.chars}字 / ${t.hook}）`).join('\n')}\n\n` +
    `【残った軽微な指摘】\n${remaining.map((i) => `- [${i.lens}] ${i.problem}`).join('\n') || 'なし'}\n\n` +
    `【要検証ファクト】\n${factsToVerify.map((f) => `- ${f}`).join('\n')}\n\n` +
    `【調査時点で未取得だった項目】\n${openIssues.map((f) => `- ${f}`).join('\n')}\n\n` +
    `次を確定せよ。\n` +
    `1) title：候補から最もCTRが取れる1本を選ぶ（全角30〜34字）\n` +
    `2) titleAlternatives：公開4週後のCTR次第で差し替えるA/Bテスト用に2本\n` +
    `3) metaDescription：全角120字前後。1文目で結論、2文目で独自価値（${USP}）\n` +
    `4) slug：英小文字ハイフン区切り。短く\n` +
    `5) faq：記事末FAQの構造化データ用Q&A（記事本文のFAQと一致させること）\n` +
    `6) openIssues：公開前に人間が確認・取得すべき項目を統合し、重複を除いて列挙\n\n` +
    `【記事HTML（末尾のFAQを参照すること）】\n${body.html.slice(-8000)}`,
  { label: 'タイトル・メタ確定', phase: '仕上げ', schema: S_FINAL }
)

log(`完成：${final.title}／本文${body.charCount}字／要確認${final.openIssues.length}件`)

return {
  keyword: KW,
  recon: RECON_TASKS.map((t, i) => ({ key: t.key, result: recon[i] })),
  outline: { winner, competitionScores: totals, graftIdeas: grafts },
  bodyHtml: body.html,
  charCount: body.charCount,
  auditRounds: round,
  remainingMinorIssues: remaining,
  title: final.title,
  titleAlternatives: final.titleAlternatives,
  metaDescription: final.metaDescription,
  slug: final.slug,
  faq: final.faq,
  openIssues: final.openIssues,
}
