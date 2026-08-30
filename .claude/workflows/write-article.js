export const meta = {
  name: 'write-article',
  description: 'StockSunハウス標準のSTEP①〜⑥で記事を生成（関連KW→インサイト→競合→AIO/PAA→構成→執筆→品質チェック）',
  whenToUse: '年収エージェント案件でKWを1本渡し、記事を作らせるとき。args.stopAfter="outline" で構成案の確認待ちに入る',
  phases: [
    { title: 'STEP1-4 調査', detail: '関連KW分類・ユーザーインサイト・競合上位3記事・AI Overview/PAA・カニバリを並列調査' },
    { title: 'STEP5 構成設計', detail: 'タイトル3案（王道/疑問解決/CVR重視）とh2/h3階層・CTA配置計画' },
    { title: 'STEP6 執筆', detail: 'h2単位で並列執筆し、セクションごとに推敲' },
    { title: '統合', detail: '導入文・まとめ・内部リンクを付けて1本に統合' },
    { title: '品質チェック', detail: 'チェックリスト準拠の機械監査＋SEO/表現/CVRの監査を通し、指摘を反映' },
  ],
}

const A = args || {}
const KW = A.keyword
const CLIENT = A.client || '年収エージェント'
const LP = A.lp || '/nensyuagent/'
const USP = A.usp || '担当キャリアアドバイザーを自分で選べる'
const RELATED = A.related || []
const NOTES = A.notes || ''
const TODAY = A.date || ''
const DELIVERY = A.delivery || 'ドキュメント納品'

if (!KW) throw new Error('args.keyword（対象KW）が必要です')

// StockSunハウス標準の執筆ルール（articles/*/prompts/記事制作プロンプト.md 準拠）
const SPEC = `
【基本仕様（ハウス標準・厳守）】
- 文字数：5,000〜8,000字
- 見出し構造：h2×7〜9本、h3×18〜25本
- H4タグは使用しない（段落で整理する）
- h2には必ずh3を2つ以上置く（例外なし）
- FAQはh3タグで構成し、6〜8問
- CTAは記事内に3〜4箇所
- 比較表・一覧表を多用する（最低1つは必須）
- 太字強調は重要ポイント・数値に使う
- 箇条書きは3〜5項目でまとめる
- 記事末尾に関連記事リンクを配置する

【導入文パターン（固定）】
1. 読者の悩みを引用形式（「」）で3つ提示
2. 結論の先出し or 統計データで興味喚起
3. ${CLIENT}の強みを簡潔に提示
4. 記事で解説する内容の概要

【文体・トーン】
- です・ます調
- 信頼感のある語り口。読者の不安に寄り添いつつ、具体で説得力を持たせる
- 専門用語（SIer、SES、上流工程、多重下請け構造など）は初出時に簡潔な解説を付ける
`

const RULES = `
【案件前提】
- クライアント：${CLIENT}（LP: ${LP}）
- 差別化要素（USP）：${USP}
- 関連既存記事：${RELATED.join(', ') || 'なし'}
- 納品形式：${DELIVERY}
- 補足指示：${NOTES || 'なし'}
- 基準日：${TODAY || '未指定'}

${SPEC}

【NG表現・厳守事項】
- 「必ず年収が上がる」「100%転職できる」等の断定的な保証表現は使用しない
- 他社転職エージェントの誹謗中傷・断定的な優劣評価はしない（事実の言及のみ）
- 出典のない数値は書かない。値＋時点＋出典の3点セットが揃わないものは本文に入れず「要確認」に回す
- 個人が特定できる体験談は書かない（属性のみに抽象化）
- /column/ 配下はStockSun本体SEOの管理領域。直接編集せず、依頼事項として起票する

【環境の既知の制約】
- stock-sun.com は WebFetch が EGRESS_BLOCKED を返すことがある。その場合は WebSearch 経由の
  間接情報に切り替え、裏が取れなかった事実は本文に書かず「要確認」に回す
- Ahrefs が "API units limit reached" を返したら、それ以上リトライせず「要取得」と書く。推定値は禁止
`

// ---------------- schemas ----------------
const S_RESEARCH = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    findings: { type: 'array', items: { type: 'string' } },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['summary', 'findings', 'openIssues'],
}

const S_PAA = {
  type: 'object',
  properties: {
    aiOverviewTrend: { type: 'string', description: 'AI Overviewに出る内容の傾向' },
    paa: { type: 'array', items: { type: 'string' }, description: 'PAA質問 10〜12問' },
    faqCandidates: { type: 'array', items: { type: 'string' }, description: '記事に組み込むFAQ候補 6〜8問' },
    openIssues: { type: 'array', items: { type: 'string' } },
  },
  required: ['aiOverviewTrend', 'paa', 'faqCandidates', 'openIssues'],
}

const S_OUTLINE = {
  type: 'object',
  properties: {
    titles: {
      type: 'array',
      description: 'タイトル3案（王道型・疑問解決型・CVR重視型の順）',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string' },
          title: { type: 'string' },
          chars: { type: 'integer' },
          reason: { type: 'string' },
        },
        required: ['type', 'title', 'chars', 'reason'],
      },
    },
    recommendedTitleIndex: { type: 'integer' },
    metaDescription: { type: 'string', description: '120文字以内' },
    slug: { type: 'string' },
    leadPlan: { type: 'string', description: '導入文で提示する読者の悩み3つと、先出しする結論' },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          h2: { type: 'string' },
          purpose: { type: 'string' },
          h3: { type: 'array', items: { type: 'string' }, description: '必ず2つ以上' },
          mustInclude: { type: 'array', items: { type: 'string' } },
          targetChars: { type: 'integer' },
          cta: { type: 'string' },
        },
        required: ['h2', 'purpose', 'h3', 'mustInclude', 'targetChars', 'cta'],
      },
    },
    ctaPlan: { type: 'array', items: { type: 'string' }, description: 'CTA配置計画（位置と文言）' },
    differentiation: { type: 'string', description: 'この構成でSERP上位3記事に勝てる理由' },
  },
  required: ['titles', 'recommendedTitleIndex', 'metaDescription', 'slug', 'leadPlan', 'sections', 'ctaPlan', 'differentiation'],
}

const S_SECTION = {
  type: 'object',
  properties: {
    h2: { type: 'string' },
    html: { type: 'string' },
    factsToVerify: { type: 'array', items: { type: 'string' } },
  },
  required: ['h2', 'html', 'factsToVerify'],
}

const S_BODY = {
  type: 'object',
  properties: {
    html: { type: 'string' },
    charCount: { type: 'integer' },
    h2Count: { type: 'integer' },
    h3Count: { type: 'integer' },
    notes: { type: 'array', items: { type: 'string' } },
  },
  required: ['html', 'charCount', 'h2Count', 'h3Count', 'notes'],
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
          fix: { type: 'string' },
        },
        required: ['severity', 'where', 'problem', 'fix'],
      },
    },
  },
  required: ['lens', 'issues'],
}

// ---------------- STEP①〜④ + カニバリ（バリア：全部揃わないと構成が組めない） ----------------
phase('STEP1-4 調査')
log(`対象KW「${KW}」／STEP①〜④の調査を開始`)

const TASKS = [
  {
    key: 'STEP1_関連KW',
    schema: S_RESEARCH,
    prompt: `【STEP① 関連KW洗い出し】
対象KW「${KW}」に対し、関連KWを20〜30語洗い出し、次の3分類に振り分けよ。
- 情報収集型（Know）：基礎知識・定義を調べる層
- 比較検討型（Compare）：選択肢を比較する層
- 購買・行動型（Do/Buy）：具体的な行動を起こす層
WebSearch のサジェスト・関連検索と、Ahrefs MCP（ToolSearch で読み込む）を使う。
Ahrefs が "API units limit reached" を返したら検索Volは「要取得」と書き、リトライするな。
findings には「[分類] KW」の形式で1行1語ずつ列挙せよ。`,
  },
  {
    key: 'STEP2_インサイト',
    schema: S_RESEARCH,
    prompt: `【STEP② ユーザーインサイト分析】
「${KW}」で検索する読者の心理を3フェーズで整理せよ。
1. 検索前の状態（悩み・不安・きっかけ）
2. 検索中の状態（知りたいこと・比較軸）
3. 検索後の理想状態（ゴール）
加えて「${CLIENT}に相談するまでの典型的な行動フロー」を設計せよ。
さらに、導入文で「」で提示すべき読者の悩みを3つ、実際の文言として提案せよ。
ペルソナ（年代/年収帯/職種/転職検討度）も明示すること。`,
  },
  {
    key: 'STEP3_競合調査',
    schema: S_RESEARCH,
    prompt: `【STEP③ 競合調査・分析】
WebSearch で「${KW}」の検索結果を調べ、SERP上位3記事を次の項目で分析せよ。
- URL・タイトル・推定文字数
- 見出し構成（h2/h3の数と内容。取得できた範囲で）
- CTA配置パターン
- 強み・弱み
- ${CLIENT}が勝てるポイント
加えて、上位3記事の誰も書いていない論点（コンテンツギャップ）を明示せよ。ここが最重要。`,
  },
  {
    key: 'STEP4_AIO_PAA',
    schema: S_PAA,
    prompt: `【STEP④ AI Overview・PAA分析】
「${KW}」について次を調べよ。
1. AI Overviewに表示される内容の傾向（WebSearchの結果から推定できる範囲で）
2. PAA（People Also Ask）質問を10〜12問
3. 記事に組み込むべきFAQセクション候補を6〜8問
PAAは「${KW}」およびその関連KWで検索し、実際に出てくる質問形を集めること。`,
  },
  {
    key: 'カニバリ_USP',
    schema: S_RESEARCH,
    prompt: `【案件固有チェック：カニバリとUSP整合】
1. WebSearch で「site:stock-sun.com ${KW}」等を調べ、既存記事が同KWを受けていないか確認せよ。
   特に /column/ 配下（StockSun本体SEOの管理領域）との競合を見る。
2. リポジトリの data/KW候補_*.tsv と docs/articles/ を読み、既存の記事資産を把握せよ。
3. 「${CLIENT}」のサービス事実を出典付きで集めよ。WebSearch で stock-sun.com/nensyuagent/ と
   stock-sun.com/column/annual-income-agent-reputation/ を調べる（WebFetchは EGRESS_BLOCKED になる想定）。
4. 「${KW}」の検索者にとって、USP「${USP}」がどう"解"になるかを1段落で書け。
裏が取れていない事実を findings に混ぜるな。取れなかったものは openIssues へ。`,
  },
]

const res = await parallel(
  TASKS.map((t) => () =>
    agent(`${RULES}\n\n${t.prompt}`, { label: t.key, phase: 'STEP1-4 調査', schema: t.schema })
  )
)

const paa = res[3]
const brief = TASKS.map((t, i) => {
  const r = res[i]
  if (!r) return `### ${t.key}\n(取得失敗)`
  if (t.key === 'STEP4_AIO_PAA') {
    return `### ${t.key}\nAI Overview傾向: ${r.aiOverviewTrend}\nPAA:\n${r.paa.map((q) => `- ${q}`).join('\n')}\nFAQ候補:\n${r.faqCandidates.map((q) => `- ${q}`).join('\n')}`
  }
  return `### ${t.key}\n${r.summary}\n${r.findings.map((f) => `- ${f}`).join('\n')}`
}).join('\n\n')

const openIssues = res.filter(Boolean).flatMap((r) => r.openIssues || [])
log(`STEP①〜④完了：${res.filter(Boolean).length}/${TASKS.length}件成功、要確認${openIssues.length}件`)

// ---------------- STEP⑤ 構成設計 ----------------
phase('STEP5 構成設計')

const outline = await agent(
  `${RULES}\n\n【STEP①〜④の調査結果】\n${brief}\n\n` +
    `【STEP⑤ タイトル・記事構成設計】\n` +
    `1) タイトルを3案作れ。type は順に「王道型」「疑問解決型」「CVR重視型」。全角30〜34字。主KW「${KW}」を必ず含む\n` +
    `2) recommendedTitleIndex で推奨案を1つ選べ\n` +
    `3) metaDescription は120文字以内\n` +
    `4) slug は英小文字ハイフン区切り\n` +
    `5) leadPlan：導入文で「」提示する読者の悩み3つと、先出しする結論\n` +
    `6) sections：h2を7〜9本。**各h2にh3を2つ以上**、合計h3が18〜25本になるよう配分せよ\n` +
    `   各h2に purpose / mustInclude（表・比較・データ等）/ targetChars / cta を明記\n` +
    `   STEP④のFAQ候補6〜8問は、最後のh2「よくある質問」にh3として配置せよ\n` +
    `7) ctaPlan：CTAを3〜4箇所。導入直後／中盤（デメリット・注意点の後）／記事末尾の配置と文言\n` +
    `8) differentiation：この構成でSERP上位3記事に勝てる理由\n\n` +
    `全h2のtargetCharsの合計が5,000〜8,000字に収まるようにせよ。`,
  { label: '構成設計', phase: 'STEP5 構成設計', schema: S_OUTLINE }
)

const h3Total = outline.sections.reduce((n, s) => n + s.h3.length, 0)
log(`構成完成：h2×${outline.sections.length}／h3×${h3Total}／目標${outline.sections.reduce((n, s) => n + s.targetChars, 0)}字`)

if (A.stopAfter === 'outline') {
  log('構成案までで停止。ユーザーの確認後、resumeFromRunId で執筆フェーズから再開する')
  return {
    stage: 'outline',
    keyword: KW,
    research: TASKS.map((t, i) => ({ key: t.key, result: res[i] })),
    paa,
    outline,
    h2Count: outline.sections.length,
    h3Count: h3Total,
    openIssues,
  }
}

// ---------------- STEP⑥ 執筆 ----------------
phase('STEP6 執筆')
log(`${outline.sections.length}本のh2を並列執筆`)

const sections = await pipeline(
  outline.sections.map((s, i) => ({ s, i })),
  ({ s, i }) =>
    agent(
      `${RULES}\n\n【調査結果】\n${brief}\n\n` +
        `【記事全体のh2一覧（重複回避のため）】\n${outline.sections.map((x, n) => `${n}. ${x.h2}`).join('\n')}\n` +
        `【記事タイトル】${outline.titles[outline.recommendedTitleIndex].title}\n\n` +
        `あなたは第${i}セクション「${s.h2}」だけを書く。\n` +
        `役割: ${s.purpose}\n` +
        `h3（この通りに全部使う。過不足なく）: ${s.h3.join(' / ')}\n` +
        `必須要素: ${s.mustInclude.join(' / ')}\n目標文字数: ${s.targetChars}字\nCTA: ${s.cta || 'なし'}\n\n` +
        `<h2>から始まるHTML断片で出力。**H4は絶対に使うな**。他セクションの内容は書くな。\n` +
        `h2直下に結論を1文置け。裏が取れていない数値は書かず factsToVerify に回せ。\n` +
        `CTAを置く場合のリンクは <a href="${LP}">…</a> の形式にせよ。`,
      { label: `執筆:${s.h2.slice(0, 16)}`, phase: 'STEP6 執筆', schema: S_SECTION }
    ),
  (draft, { s, i }) =>
    draft
      ? agent(
          `${RULES}\n\n次のセクションHTMLを推敲せよ。内容は減らさず質だけ上げる。\n` +
            `- 1文を短く割る／語尾の3連続を崩す／曖昧語を具体に置換\n` +
            `- 「〜と言えるでしょう」等の逃げ表現、AIっぽい定型を排除\n` +
            `- 専門用語（SIer/SES/上流工程/多重下請け等）に初出解説があるか確認\n` +
            `- H4を使っていないか、h3が指定通り揃っているか確認\n` +
            `- 効果保証・他社批判・出典なし数値がないか最終確認\n\n` +
            `【対象（第${i}セクション: ${s.h2}）】\n${draft.html}`,
          { label: `推敲:${s.h2.slice(0, 16)}`, phase: 'STEP6 執筆', schema: S_SECTION }
        )
      : null
)

const sectionHtml = sections.filter(Boolean).map((s) => s.html).join('\n\n')
const factsToVerify = sections.filter(Boolean).flatMap((s) => s.factsToVerify)
log(`執筆完了：${sections.filter(Boolean).length}セクション／要検証ファクト${factsToVerify.length}件`)

// ---------------- 統合 ----------------
phase('統合')

let body = await agent(
  `${RULES}\n\n【導入文の方針】\n${outline.leadPlan}\n\n【CTA配置計画】\n${outline.ctaPlan.map((c) => `- ${c}`).join('\n')}\n\n` +
    `【要検証ファクト】\n${factsToVerify.map((f) => `- ${f}`).join('\n')}\n\n` +
    `以下は別々のエージェントが書いたセクションHTMLを連結したものだ。1本の記事に統合せよ。\n` +
    `1) 冒頭に導入文を追加。**必ず読者の悩み3つを「」の引用形式で提示**し、結論先出し→${CLIENT}の強み→記事概要の順で書く\n` +
    `2) セクション間の接続を整え、重複した説明を削る\n` +
    `3) CTA配置計画どおりにCTAを3〜4箇所置く（リンク先: ${LP}）\n` +
    `4) 記事末に「まとめ」と関連記事リンク（${RELATED.join(', ') || 'なし'}）を追加\n` +
    `5) 裏の取れていない記述には <!-- <<< 要ファクトチェック：… >>> --> を付ける\n` +
    `6) **H4は使わない。h2にはh3が2つ以上。文字数5,000〜8,000字**\n` +
    `出力は本文HTMLのみ。内容量は減らすな。h2Count / h3Count は実際に数えて返せ。\n\n` +
    `【連結HTML】\n${sectionHtml}`,
  { label: '統合', phase: '統合', schema: S_BODY }
)

// ---------------- 品質チェック（ハウスのチェックリスト準拠＋監査） ----------------
phase('品質チェック')

const LENSES = [
  {
    name: 'チェックリスト',
    focus: `StockSunハウス標準の品質チェックリストに機械的に照合せよ。1項目ずつ実際に数えて判定すること。
[ ] 文字数が5,000字以上あるか
[ ] h2にはすべてh3が2つ以上あるか
[ ] H4タグを使用していないか
[ ] FAQセクションがh3タグで構成され6〜8問あるか
[ ] CTAが3箇所以上配置されているか
[ ] 導入文に読者の悩み3つが「」で提示されているか
[ ] 具体的な数値・データが含まれているか
[ ] ${CLIENT}の差別化要素が自然に組み込まれているか
[ ] NG表現（効果保証・他社批判）が含まれていないか
[ ] 比較表が最低1つ含まれているか
[ ] 内部リンクが2本以上含まれているか
未達の項目はすべて blocker として、どこをどう直すかを fix に書け。`,
  },
  { name: 'SEO', focus: `主KW「${KW}」と関連KWの網羅、見出し構造、SERP上位3記事に対する優位性、PAA由来の論点の欠落` },
  { name: '表現規制', focus: '効果保証・他社の優劣評価・出典なし数値・個人特定・料金の断定。専門用語の初出解説漏れ' },
  { name: 'CVR', focus: 'CTAの位置と文言、USPへの橋渡しの自然さ、広告記事に見えていないか、読者の次の行動が明確か' },
]

let round = 0
let remaining = []
while (round < 3) {
  round++
  const audits = await parallel(
    LENSES.map((l) => () =>
      agent(
        `${RULES}\n\n【調査結果】\n${brief}\n\n` +
          `あなたは「${l.name}」の観点だけを見る監査役だ。\n観点：${l.focus}\n\n` +
          `対象記事を批判的に読み、問題を指摘せよ。severity は blocker/major/minor。\n` +
          `fix は「どこをどう直すか」まで具体的に。問題がなければ issues を空配列で返せ。\n\n` +
          `【記事HTML】\n${body.html}`,
        { label: `監査:${l.name}(R${round})`, phase: '品質チェック', schema: S_AUDIT }
      )
    )
  )

  const issues = audits.filter(Boolean).flatMap((a) => a.issues.map((i) => ({ ...i, lens: a.lens })))
  const serious = issues.filter((i) => i.severity === 'blocker' || i.severity === 'major')
  log(`品質チェックR${round}：指摘${issues.length}件（うち要対応${serious.length}件）`)

  if (!serious.length) { remaining = issues; break }

  body = await agent(
    `${RULES}\n\n以下の指摘をすべて反映して記事を修正せよ。\n` +
      `内容量は減らすな。指摘のない箇所は変えるな。相反する指摘は読者価値を優先し notes に理由を書け。\n` +
      `修正後、h2Count / h3Count / charCount は必ず数え直して返せ。\n\n` +
      `【指摘】\n${serious.map((i) => `- [${i.lens}/${i.severity}] ${i.where}｜${i.problem}\n  → ${i.fix}`).join('\n')}\n\n` +
      `【記事HTML】\n${body.html}`,
    { label: `修正(R${round})`, phase: '品質チェック', schema: S_BODY }
  )
  remaining = issues.filter((i) => i.severity === 'minor')
}

const chosen = outline.titles[outline.recommendedTitleIndex]
log(`完成：${chosen.title}／${body.charCount}字／h2×${body.h2Count}・h3×${body.h3Count}`)

return {
  stage: 'complete',
  keyword: KW,
  research: TASKS.map((t, i) => ({ key: t.key, result: res[i] })),
  paa,
  outline,
  title: chosen.title,
  titleAlternatives: outline.titles.filter((_, i) => i !== outline.recommendedTitleIndex),
  metaDescription: outline.metaDescription,
  slug: outline.slug,
  bodyHtml: body.html,
  charCount: body.charCount,
  h2Count: body.h2Count,
  h3Count: body.h3Count,
  auditRounds: round,
  remainingMinorIssues: remaining,
  factsToVerify,
  openIssues,
}
