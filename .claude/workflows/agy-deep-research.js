export const meta = {
  name: 'agy-deep-research',
  description: 'Multi-angle deep research via agy (Gemini), then Claude cross-check, synthesis and red-team review',
  whenToUse: 'Deep research on any topic (business, science, medicine, law, history, policy, tech choices): args = {topic, slug?, audience?, angleCount?, angles?, outline?, profile?, model?, today?, outDir?, reportDir?}. Needs the cc-suite plugin (agy runner). Writes reports/<slug>.md and research_notes/agy-deep-research/<slug>/{raw/,ledger.json} under the project root.',
  phases: [
    { title: 'Plan', detail: 'Claude (opus, xhigh) designs the domain profile, research angles and report outline (skipped if angles are given)', model: 'opus' },
    { title: 'Research', detail: 'one agy (Gemini) deep-research run per angle, claims extracted by Claude' },
    { title: 'Cross-check', detail: 'Claude verifiers re-check claims through the profile\'s lenses, plus cross-angle contradictions' },
    { title: 'Synthesize', detail: 'Claude writes the report from verified findings only' },
    { title: 'Red-team', detail: 'Claude critic audits the draft and writes the final report' },
  ],
}

const A = args || {}
if (!A.topic) throw new Error('agy-deep-research needs args.topic, e.g. {topic: "AI 陪伴硬件创业"}')
const toSlug = (s) => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const TOPIC = A.topic
const SLUG = A.slug || toSlug(TOPIC)
// Default paths are relative to the project root; scripts have no filesystem access, so the agents resolve them.
const OUT = A.outDir || `research_notes/agy-deep-research/${SLUG}`
const REPORT = `${A.reportDir || 'reports'}/${SLUG}.md`
const PATHS = '相对路径都相对于项目根目录（即你的当前工作目录）；使用 Write 或 Edit 前先解析成绝对路径。'
const MODEL = A.model || 'Gemini 3.8 Flash (High)'
const TODAY = A.today ? `今天是 ${A.today}` : '以运行环境的当前日期为准'
const N_ANGLES = A.angleCount || 6
const DEFAULT_AUDIENCE = '正在评估这个方向的独立创业者'

// Domain profile: everything downstream that depends on the kind of topic.
// BUSINESS_PROFILE is used when angles are passed in (no Plan run); args.profile overrides either.
const BUSINESS_PROFILE = {
  researcherRole: '资深产业研究员',
  leadRole: '产业研究负责人',
  reviewerRole: '怀疑论的投资委员会成员',
  sourceTypes: '媒体报道、公司官网、融资公告、财报、论文、研报、投资人访谈',
  languages: '中文、英文',
  timeScope: '优先使用最近一两年的最新信息',
  evidenceRules: '一手来源（公司公告、政府文件、财报）优于媒体转述；不同来源数字冲突时并列列出；创业公司自报数字视为单方说法。',
  claimKinds: [
    { key: 'number', desc: '市场规模、价格、成本、用户量等数字' },
    { key: 'funding', desc: '融资事件、估值、投资方、并购' },
    { key: 'company', desc: '公司是否存在及其产品、客户、规模' },
    { key: 'tech', desc: '技术路线、产品能力、数据集的事实描述' },
    { key: 'policy', desc: '政策文件、法规、标准' },
  ],
  verifyLenses: [
    { key: 'numbers', lens: '市场规模、价格与成本数字、融资事件与估值、政策文件', kinds: ['number', 'funding', 'policy'] },
    { key: 'entities', lens: '公司是否存在及其产品/客户/规模、技术路线与产品的事实描述', kinds: ['company', 'tech'] },
  ],
}

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    audience: { type: 'string', description: '报告读者；用户已指定时原样照抄' },
    profile: {
      type: 'object',
      properties: {
        researcherRole: { type: 'string', description: '调研员身份，如"资深产业研究员""循证医学研究员""明清经济史学者"' },
        leadRole: { type: 'string', description: '报告撰写人身份' },
        reviewerRole: { type: 'string', description: '跨角度逻辑审查者身份，如"怀疑论的投资委员会成员""同行评审专家"' },
        sourceTypes: { type: 'string', description: '优先的来源类型，按可信度排列' },
        languages: { type: 'string', description: '需要检索的来源语言，含当地语言' },
        timeScope: { type: 'string', description: '时间范围要求' },
        evidenceRules: { type: 'string', description: '该领域判断证据强弱的规则，以及需要的免责声明' },
        claimKinds: {
          type: 'array',
          minItems: 3,
          maxItems: 7,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'short snake_case id，不要用 opinion' },
              desc: { type: 'string' },
            },
            required: ['key', 'desc'],
          },
        },
        verifyLenses: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            properties: {
              key: { type: 'string', description: 'short kebab-case id' },
              lens: { type: 'string', description: '该核查员负责核查什么、去哪里核查' },
              kinds: { type: 'array', items: { type: 'string' }, description: '负责的 claimKinds key' },
            },
            required: ['key', 'lens', 'kinds'],
          },
        },
      },
      required: ['researcherRole', 'leadRole', 'reviewerRole', 'sourceTypes', 'languages', 'timeScope', 'evidenceRules', 'claimKinds', 'verifyLenses'],
    },
    angles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'short kebab-case id' },
          title: { type: 'string' },
          focus: { type: 'string', description: '调研重点，2-4 句，点名该主题下具体的子问题、代表主体/研究/数据源' },
        },
        required: ['key', 'title', 'focus'],
      },
    },
    outline: { type: 'array', items: { type: 'string' }, description: '报告章节，每项一句话说明该章回答什么' },
  },
  required: ['audience', 'profile', 'angles', 'outline'],
}

const claimsSchema = (kinds) => ({
  type: 'object',
  properties: {
    angle: { type: 'string' },
    agyStatus: { type: 'string', enum: ['completed', 'failed', 'stalled', 'fallback'] },
    rawPath: { type: 'string' },
    summary: { type: 'string', description: '400-800 字中文要点综述' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          kind: { type: 'string', enum: [...kinds, 'opinion'] },
          importance: { type: 'integer', minimum: 1, maximum: 3, description: '3 = 结论依赖它' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'claim', 'kind', 'importance', 'sources'],
      },
    },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['angle', 'agyStatus', 'rawPath', 'summary', 'claims', 'openQuestions'],
})

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'corrected', 'disputed', 'unverifiable', 'false'] },
          corrected: { type: 'string', description: '若 corrected/false，给出正确表述；否则空字符串' },
          evidence: { type: 'string' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'verdict', 'corrected', 'evidence', 'sources'],
      },
    },
    notes: { type: 'string' },
  },
  required: ['verdicts', 'notes'],
}

const CONTRA_SCHEMA = {
  type: 'object',
  properties: {
    contradictions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          claimIds: { type: 'array', items: { type: 'string' } },
          issue: { type: 'string' },
          resolution: { type: 'string' },
        },
        required: ['claimIds', 'issue', 'resolution'],
      },
    },
    hypeFlags: { type: 'array', items: { type: 'string' }, description: '证据薄弱但被反复强调的叙事' },
    gaps: { type: 'array', items: { type: 'string' }, description: '所有角度都没覆盖的关键问题' },
  },
  required: ['contradictions', 'hypeFlags', 'gaps'],
}

phase('Plan')
let plan
if (A.angles) {
  plan = { audience: A.audience || DEFAULT_AUDIENCE, profile: BUSINESS_PROFILE, angles: A.angles, outline: A.outline || [] }
} else {
  plan = await agent(`你是一名跨领域的研究总监。要就「${TOPIC}」组织一次多角度深度研究，${TODAY}。先做几次 WebSearch 了解这个话题的现状和所属领域，再完成下面四件事。

1. audience：${A.audience ? `读者已指定为「${A.audience}」，原样填写。` : `读者未指定：推断最可能需要这份报告的人（如创业者、投资人、临床医生、政策研究者、工程师、历史爱好者、普通读者），具体到他们要拿报告做什么决定或理解什么问题。`}

2. profile：为这个话题所属的领域设计研究配置，下游所有调研员、核查员、审查者和撰写人都按它工作，所以必须贴合领域，不要套商业模板（除非话题本身就是商业问题）。
   - researcherRole / leadRole / reviewerRole：该领域里最合适的调研员、报告撰写人、逻辑审查者身份。
   - sourceTypes：按可信度排列的优先来源类型（如医学：系统综述与荟萃分析、RCT、临床指南、监管机构文件；历史：一手档案与史料汇编、权威史学著作、学术期刊；商业：公告、财报、融资披露、研报）。
   - languages：需要检索的来源语言；涉及特定国家/地区时必须包含当地语言。
   - timeScope：时间范围（前沿和市场话题强调最新进展；历史话题写明研究的时段，并要求兼顾经典与近年研究）。
   - evidenceRules：该领域判断证据强弱的规则（如证据等级、样本量、是否被复现、利益冲突、一手与转述）；医疗、法律、投资类话题写明报告须注明不构成专业建议。
   - claimKinds：3-7 个可核查论断类别（key 不要用 opinion——观点、预测、推测会自动归入 opinion 类，不做事实核查）。类别要覆盖该领域最需要核查的事实，例如医学可以是 trial_result / mechanism / guideline / regulatory / epidemiology。
   - verifyLenses：1-3 个事实核查员，每个写明负责核查什么、去哪类来源核查，并通过 kinds 认领 claimKinds；每个类别都要有人认领。

3. angles：把话题拆成恰好 ${N_ANGLES} 个调研角度，交给不同研究员并行调研。角度合起来要覆盖读者需要的全部信息；每个角度的 focus 要点名具体子问题、代表主体/研究/数据源，而不是泛泛而谈。若是商业话题，一般应涉及需求与市场、技术或供给路线、竞争格局、商业模式与单位经济、资本、政策与风险，但按话题取舍。

4. outline：最终报告的章节大纲（8-11 章）。第一章是执行摘要（≤10 条，含一句话判断）；中间章节按话题和读者定制；倒数第二章是关键不确定性与下一步验证；最后一章是附录（核查台账摘要与方法说明）。若读者是创业者，须包含"切入点/机会"章节（逐个给出目标客户、差异化、启动成本、主要风险、验证第一步）和"风险与失败模式"章节。`,
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA, model: 'opus', effort: 'xhigh' })
}
const AUDIENCE = A.audience || plan.audience
const P = { ...plan.profile, ...(A.profile || {}) }
const ANGLES = plan.angles
const KINDS = P.claimKinds.filter(k => k.key !== 'opinion')
// Each kind is verified by exactly one lens: the first that claims it; unclaimed kinds go to the last lens.
const kindOwner = {}
P.verifyLenses.forEach((l, i) => l.kinds.forEach(k => { if (!(k in kindOwner)) kindOwner[k] = i }))
const unclaimed = KINDS.map(k => k.key).filter(k => !(k in kindOwner))
for (const k of unclaimed) kindOwner[k] = P.verifyLenses.length - 1
if (unclaimed.length) log(`没有核查员认领的论断类别 ${unclaimed.join(', ')} 已交给 ${P.verifyLenses.at(-1).key}`)
log(`读者：${AUDIENCE}；调研员：${P.researcherRole}；论断类别：${KINDS.map(k => k.key).join(', ')}；核查员：${P.verifyLenses.map(l => l.key).join(', ')}`)

const agyPrompt = (a) => `你是一名${P.researcherRole}。请就「${TOPIC}」中的「${a.title}」这一角度做深度网络调研（${TODAY}；时间范围：${P.timeScope}）。

调研重点：${a.focus}

要求：
- 广泛使用网络搜索，交叉多个来源，优先使用：${P.sourceTypes}。来源语言：${P.languages}。
- 证据规则：${P.evidenceRules}
- 每个事实性陈述后面用 [来源: URL] 标注；找不到来源的要明确写"未经证实"。
- 区分事实与观点；对相互矛盾的数据或结论要并列列出。
- 输出结构：1) 核心结论（5-8 条）2) 详细发现 3) 关键数据/证据表 4) 代表性案例、研究或主体 5) 不确定性与待验证问题。
- 用中文撰写，篇幅 2000-4000 字。只做调研和写作，不要修改任何文件。`

const researchPrompt = (a) => `你的任务：调用 Antigravity CLI（agy，Gemini 模型）对一个研究角度做深度调研，保存原始报告，然后把它拆成可核查的论断。

研究主题：${TOPIC}
角度：${a.title}（key: ${a.key}）

${PATHS}

步骤：
1. \`mkdir -p "${OUT}/raw"\`，用 Write 把下面 <agy_prompt> 里的内容原样写入 \`${OUT}/raw/${a.key}.prompt.txt\`。
2. 用 Bash 运行（Bash 的 timeout 参数设为 600000）：
   \`\`\`
   RUNNER=$(ls -d ~/.claude/plugins/cache/xiaolai/cc-suite/*/scripts/agy-runner.mjs | sort -V | tail -1)
   node "$RUNNER" --kind agy --model "${MODEL}" --sandbox read-only --timeout-ms 570000 \\
     --summary "agy research: ${a.key}" -- "$(cat "${OUT}/raw/${a.key}.prompt.txt")" > "${OUT}/raw/${a.key}.json"
   \`\`\`
   输出是一个 JSON 对象 {jobId, status, threadId, rawOutput}。用 python3 -I 或 jq 把 rawOutput 写入 \`${OUT}/raw/${a.key}.md\`。
3. 如果 status 不是 completed 或 rawOutput 为空/明显截断：不要重复调用 agy。改为你自己用 WebSearch/WebFetch 就该角度做调研（同样要求每个事实带 URL，来源优先级：${P.sourceTypes}），把结果写入 \`${OUT}/raw/${a.key}.md\`，并把 agyStatus 设为 "fallback"（在 summary 开头注明 agy 的失败状态）。否则 agyStatus = "completed"。
4. 阅读原始报告，返回结构化结果：
   - summary：400-800 字中文要点综述。
   - claims：抽取 10-25 条可核查论断，id 用 "${a.key}-1"、"${a.key}-2"…；kind 从下列类别中选：
${KINDS.map(k => `     - ${k.key}：${k.desc}`).join('\n')}
     - opinion：观点、预测、推测。opinion 不会被事实核查，所以能查证的事实不要归为 opinion。
     保留原报告给出的来源 URL（没有就留空数组，不要编造）；importance 3 表示结论依赖它。
   - openQuestions：报告留下的未解决问题。
   - rawPath：\`${OUT}/raw/${a.key}.md\`

<agy_prompt>
${agyPrompt(a)}
</agy_prompt>`

phase('Research')
log(`主题：${TOPIC}；${ANGLES.length} 个角度（${ANGLES.map(a => a.key).join(', ')}），agy 模型：${MODEL}`)
const CLAIMS_SCHEMA = claimsSchema(KINDS.map(k => k.key))
const research = (await parallel(ANGLES.map(a => () =>
  agent(researchPrompt(a), { label: `agy:${a.key}`, phase: 'Research', schema: CLAIMS_SCHEMA })
))).filter(Boolean)

const fallbacks = research.filter(r => r.agyStatus !== 'completed').map(r => r.angle)
if (fallbacks.length) log(`agy 未完成、已由 Claude 兜底调研的角度：${fallbacks.join(', ')}`)
if (research.length < ANGLES.length) log(`有 ${ANGLES.length - research.length} 个角度彻底失败，报告将缺少这些角度`)

// Barrier is deliberate: verifiers dedupe and compare claims across all angles.
phase('Cross-check')
const allClaims = research.flatMap(r => r.claims.map(c => ({ ...c, angle: r.angle })))
const byPriority = (xs) => [...xs].sort((x, y) => y.importance - x.importance)
const CAP = 45
const opinions = allClaims.filter(c => c.kind === 'opinion')
if (opinions.length) log(`opinion 类论断 ${opinions.length} 条不做事实核查，只参与跨角度逻辑审查，报告中须作为观点引用`)
const lensClaims = P.verifyLenses.map((l, i) => byPriority(allClaims.filter(c => kindOwner[c.kind] === i)))
P.verifyLenses.forEach((l, i) => {
  const n = lensClaims[i].length
  if (n > CAP) log(`${l.key} 核查员负责的论断 ${n} 条，只核查 importance 最高的 ${CAP} 条，其余 ${n - CAP} 条标为未核查`)
})

const verifyPrompt = (lens, claims) => `你是一名事实核查员，用独立检索复核另一个模型（Gemini）调研得出的论断。主题：${TOPIC}。${TODAY}。
核查范围：${lens}
证据规则：${P.evidenceRules}
可信来源优先级：${P.sourceTypes}（来源语言：${P.languages}）

对下面每条论断，用 WebSearch / WebFetch 找一手或权威来源独立核实（不要只信论断附带的 URL，要打开或另找来源）。默认怀疑：找不到可靠来源就判 unverifiable，不要放水；来源证据等级不足以支撑论断的强度时，按 corrected 改成与证据相称的表述。
- confirmed：独立来源证实
- corrected：大体对但数字/日期/主体/强度有误，在 corrected 中给出正确表述
- disputed：来源之间互相矛盾
- unverifiable：查不到可靠来源
- false：有证据表明错误

每条都要返回一个 verdict，id 保持不变。

<claims>
${JSON.stringify(claims.map(({ id, claim, sources, angle }) => ({ id, angle, claim, sources })), null, 1)}
</claims>`

const [contra, ...lensVerdicts] = await parallel([
  () => agent(`你是一名${P.reviewerRole}。下面是 ${research.length} 个角度对「${TOPIC}」的调研综述和论断（来自 Gemini）。不需要联网，专做逻辑审查：
1. 找出不同角度之间相互矛盾的论断（给出 claimIds、矛盾点、你认为更可信的一方及理由）。
2. 标记"证据薄弱但被反复强调"的叙事，包括把 opinion 类论断当成定论的地方。
3. 列出所有角度都没覆盖、但对「${AUDIENCE}」至关重要的问题。

<summaries>
${research.map(r => `## ${r.angle}\n${r.summary}\n未解决问题：${r.openQuestions.join('；')}`).join('\n\n')}
</summaries>

<claims>
${JSON.stringify(allClaims.map(({ id, claim, kind }) => ({ id, kind, claim })), null, 1)}
</claims>`, { label: 'cross-angle-logic', phase: 'Cross-check', schema: CONTRA_SCHEMA }),
  ...P.verifyLenses.map((l, i) => () => agent(verifyPrompt(l.lens, lensClaims[i].slice(0, CAP)),
    { label: `verify:${l.key}`, phase: 'Cross-check', schema: VERDICT_SCHEMA })),
])

const verdictById = {}
for (const v of lensVerdicts.flatMap(r => r?.verdicts || [])) verdictById[v.id] = v
const ledger = allClaims.map(c => ({
  ...c,
  verdict: c.kind === 'opinion' ? 'opinion' : verdictById[c.id]?.verdict || 'unchecked',
  corrected: verdictById[c.id]?.corrected || '',
  evidence: verdictById[c.id]?.evidence || '',
  verifySources: verdictById[c.id]?.sources || [],
}))
const tally = ledger.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] || 0) + 1 }), {})
log(`核查结果：${JSON.stringify(tally)}`)

phase('Synthesize')
const outline = plan.outline.length ? plan.outline : [
  '执行摘要（≤10 条，含一句话判断）',
  '按调研角度组织的主体章节',
  '关键不确定性与下一步要做的验证',
  '附录：核查台账摘要与方法说明',
]
const draft = await agent(`你是一名${P.leadRole}，为「${AUDIENCE}」撰写关于「${TOPIC}」的深度研究报告（中文 Markdown）。${TODAY}。

材料：${research.length} 个角度的 Gemini 调研综述、逐条核查台账、跨角度逻辑审查。原始报告在 ${OUT}/raw/*.md，必要时可读取细节。

写作规则：
- 只有 verdict 为 confirmed 的论断可以直接陈述为事实；corrected 用修正后的表述；disputed / unverifiable / unchecked 必须显式标注（如"〔未证实〕"）；false 不得使用；opinion 只能作为观点引用并注明是谁的观点。
- 证据规则：${P.evidenceRules}
- 关键数字与核心论断后附来源链接（优先用核查员找到的来源）。
- 结构（按下列大纲，可依材料微调）：
${outline.map((o, i) => `  ${i + 1}. ${o}`).join('\n')}
- 方法说明中注明哪些角度由 Claude 兜底而非 agy 完成：${fallbacks.join(', ') || '无'}。
- 返回完整 Markdown 正文。

<summaries>
${research.map(r => `## ${r.angle}（agy: ${r.agyStatus}）\n${r.summary}`).join('\n\n')}
</summaries>

<ledger>
${JSON.stringify(ledger.map(({ id, angle, claim, verdict, corrected, evidence, sources, verifySources }) =>
  ({ id, angle, claim, verdict, corrected, evidence, sources: [...verifySources, ...sources].slice(0, 3) })), null, 1)}
</ledger>

<cross_angle_review>
${JSON.stringify(contra, null, 1)}
</cross_angle_review>

<verifier_notes>
${P.verifyLenses.map((l, i) => `[${l.key}] ${lensVerdicts[i]?.notes || '(无输出)'}`).join('\n')}
</verifier_notes>`, { label: 'synthesize', phase: 'Synthesize' })

phase('Red-team')
const final = await agent(`你是一名苛刻的审稿人兼编辑。下面是一份关于「${TOPIC}」的研究报告草稿，以及它所依据的核查台账。

任务：
1. 审查：找出草稿中 (a) 把未证实/被否定的论断或观点当事实写的地方，(b) 没有证据支撑的结论跳跃，(c) 过度乐观、幸存者偏差或夸大证据强度，(d) 对「${AUDIENCE}」没有用处或不可执行的内容，(e) 遗漏的重要风险或反方观点，(f) 违反该领域证据规则的地方：${P.evidenceRules} 可用 WebSearch 抽查 3-5 个最关键的事实。
2. 直接修订草稿，产出最终版；在报告末尾追加一节「审稿说明」，列出你做了哪些主要修改及仍存在的薄弱处。
3. 用 Write 把最终版写入 \`${REPORT}\`，并把核查台账以 JSON 写入 \`${OUT}/ledger.json\`。${PATHS}
4. 返回：最终报告路径，以及 5 条以内的最重要结论（纯文本）。

<draft>
${draft}
</draft>

<ledger>
${JSON.stringify(ledger, null, 1)}
</ledger>`, { label: 'red-team', phase: 'Red-team' })

return { report: REPORT, rawDir: `${OUT}/raw`, audience: AUDIENCE, profile: P, tally, fallbacks, final }
