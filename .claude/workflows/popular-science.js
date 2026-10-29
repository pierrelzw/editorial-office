export const meta = {
  name: 'popular-science',
  description: 'Research any topic from multiple angles, adversarially fact-check it, then draft and polish a popular science article',
  whenToUse: 'Popular science article on any topic: args = {topic, runTag?, slug?, audience?, length?, lang?, angleCount?, angles?, outDir?, articleDir?, today?}. Writes articles/<slug>/<version>-<runTag>.md and research_notes/popular-science/<slug>/<version>-<runTag>/ledger.json under the project root.',
  phases: [
    { title: 'Plan', detail: 'editor splits the topic into investigation angles and reader questions' },
    { title: 'Investigate', detail: 'one researcher per angle, each followed by an adversarial fact-checker' },
    { title: 'Draft', detail: 'science writer drafts from verified claims only' },
    { title: 'Review', detail: 'accuracy reviewer and lay-reader reviewer critique the draft in parallel' },
    { title: 'Polish', detail: 'editor revises, adds sources, and writes the final article' },
    { title: 'Verify', detail: 'final gate checks the polished article against the draft and ledger, fixing must-fix issues' },
  ],
}

const VERSION = '3'

const A = args || {}
if (!A.topic) throw new Error('popular-science needs args.topic, e.g. {topic: "Why do we dream?"}')
const toSlug = (s) => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '')
const TOPIC = A.topic
const SLUG = A.slug || toSlug(TOPIC)
const RUN_TAG = A.runTag ? toSlug(A.runTag) : 'untagged'
const RUN = `${VERSION}-${RUN_TAG}`
// Each run gets its own article file and notes dir, keyed by VERSION-runTag.
// Default paths are relative to the project root; scripts have no filesystem access, so the writing agents resolve them.
const OUT = `${A.outDir || `research_notes/popular-science/${SLUG}`}/${RUN}`
const ARTICLE = `${A.articleDir || 'articles'}/${SLUG}/${RUN}.md`
const PATHS = 'Relative paths are relative to the project root (your current working directory); resolve them to absolute paths before using Write or Edit.'
const AUDIENCE = A.audience || 'curious general readers with no science background — a smart 15-year-old or a busy adult reading on their phone'
const LENGTH = A.length || 'about 1800–2500 words (or 3000–4500 characters if written in Chinese)'
const LANG = A.lang || 'the same language the topic is written in'
const TODAY = A.today ? `Today is ${A.today}.` : 'Use the current date from your environment.'
const N_ANGLES = A.angleCount || 5

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    workingTitle: { type: 'string' },
    angles: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'short kebab-case id' },
          title: { type: 'string' },
          focus: { type: 'string', description: 'what to investigate, 2-4 sentences' },
        },
        required: ['key', 'title', 'focus'],
      },
    },
    readerQuestions: { type: 'array', items: { type: 'string' }, description: 'questions a curious layperson would actually ask' },
  },
  required: ['workingTitle', 'angles', 'readerQuestions'],
}

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    angle: { type: 'string' },
    summary: { type: 'string', description: '300-600 word plain-language summary of what was found' },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          claim: { type: 'string' },
          kind: { type: 'string', enum: ['mechanism', 'number', 'history', 'frontier', 'consensus', 'person'] },
          importance: { type: 'integer', minimum: 1, maximum: 3, description: '3 = the article depends on it' },
          basis: {
            type: 'object',
            description: 'what kind of evidence the claim rests on',
            properties: {
              design: { type: 'string', enum: ['meta-analysis', 'rct', 'observational', 'animal', 'in-vitro', 'model', 'expert-consensus', 'historical-record', 'other'] },
              subjects: { type: 'string', description: 'who or what was studied and how many, e.g. "1,200 adults"; empty if n/a' },
              status: { type: 'string', enum: ['peer-reviewed', 'preprint', 'official-report', 'news-only', 'n/a'] },
            },
            required: ['design', 'subjects', 'status'],
          },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'claim', 'kind', 'importance', 'basis', 'sources'],
      },
    },
    analogies: { type: 'array', items: { type: 'string' }, description: 'candidate analogies or metaphors for lay readers' },
    stories: { type: 'array', items: { type: 'string' }, description: 'vivid anecdotes, experiments or discovery moments, each with a source URL' },
    misconceptions: { type: 'array', items: { type: 'string' }, description: 'popular myths about this topic and what is actually true' },
    openQuestions: { type: 'array', items: { type: 'string' } },
  },
  required: ['angle', 'summary', 'claims', 'analogies', 'stories', 'misconceptions', 'openQuestions'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          verdict: { type: 'string', enum: ['confirmed', 'corrected', 'overstated', 'disputed', 'unverifiable', 'false'] },
          corrected: { type: 'string', description: 'correct wording if corrected/overstated/false, else empty string' },
          evidence: { type: 'string' },
          consensus: { type: 'string', enum: ['strong', 'mainstream-with-dissent', 'genuinely-split', 'minority-view', 'n/a'], description: 'where expert opinion stands on this claim' },
          sources: { type: 'array', items: { type: 'string' } },
        },
        required: ['id', 'verdict', 'corrected', 'evidence', 'consensus', 'sources'],
      },
    },
    analogyIssues: {
      type: 'array',
      items: {
        type: 'object',
        properties: { analogy: { type: 'string' }, problem: { type: 'string' }, safer: { type: 'string' } },
        required: ['analogy', 'problem', 'safer'],
      },
    },
    storyIssues: { type: 'array', items: { type: 'string' }, description: 'anecdotes that are apocryphal, misattributed or unsourced' },
  },
  required: ['verdicts', 'analogyIssues', 'storyIssues'],
}

const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string', description: 'exact passage from the draft' },
          problem: { type: 'string' },
          fix: { type: 'string' },
          severity: { type: 'string', enum: ['must-fix', 'should-fix', 'nice-to-have'] },
        },
        required: ['quote', 'problem', 'fix', 'severity'],
      },
    },
    overall: { type: 'string' },
  },
  required: ['issues', 'overall'],
}

const FINAL_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    title: { type: 'string' },
    standfirst: { type: 'string', description: 'one-sentence teaser' },
    wordCount: { type: 'integer' },
    changes: { type: 'array', items: { type: 'string' }, description: 'main edits made during polishing' },
    remainingCaveats: { type: 'array', items: { type: 'string' } },
  },
  required: ['path', 'title', 'standfirst', 'wordCount', 'changes', 'remainingCaveats'],
}

phase('Plan')
log(`popular-science v${VERSION}, run ${RUN} → ${ARTICLE}`)
if (!A.runTag) log('No runTag given: untagged runs of the same slug overwrite each other')
let plan
if (A.angles) {
  plan = { workingTitle: TOPIC, angles: A.angles, readerQuestions: [] }
} else {
  plan = await agent(`You are the commissioning editor of a popular science magazine. Plan the research for an article on: "${TOPIC}".
Audience: ${AUDIENCE}. ${TODAY}

Split the topic into exactly ${N_ANGLES} investigation angles that together give a writer everything needed for an engaging, accurate article. Tailor them to this topic, but cover at least:
- the core science (how it actually works, at the mechanism level)
- the discovery story (people, experiments, wrong turns, surprises)
- the current frontier (what scientists still argue about or do not know, latest results)
- why it matters to ordinary people (everyday life, health, technology, society)
- myths and misconceptions (what people commonly get wrong, and hype to avoid)
Also list 6-10 questions a curious layperson would genuinely ask about the topic. Do a few quick web searches if the topic is unfamiliar or very recent.`,
    { label: 'plan', phase: 'Plan', schema: PLAN_SCHEMA })
}
log(`"${plan.workingTitle}" — ${plan.angles.length} angles: ${plan.angles.map(a => a.key).join(', ')}`)

const researchPrompt = (a) => `You are a science journalist researching one angle of a popular science article. ${TODAY}
Topic: ${TOPIC}
Angle: ${a.title} (key: ${a.key})
Focus: ${a.focus}

Use WebSearch and WebFetch extensively. Prefer primary and authoritative sources: peer-reviewed papers, review articles, university and agency pages (NASA, NIH, WHO, etc.), and reputable science journalism. Prefer recent sources for anything about the current state of the field.

Return:
- summary: a plain-language summary of what you found.
- claims: 8-15 checkable factual claims the article might use, ids "${a.key}-1", "${a.key}-2", … Each claim must carry the URL(s) you actually read; use an empty array rather than inventing a source. State numbers with their units, dates and scope. Mark importance 3 for claims the article would hinge on. Record each claim's basis: the study design, who or what was studied (with sample size), and whether it is peer-reviewed or a preprint.
- analogies: 2-5 analogies that would help a layperson picture the idea.
- stories: vivid anecdotes, experiments or discovery moments, each with its source URL.
- misconceptions: common myths related to this angle, each paired with what is actually true.
- openQuestions: what remains unknown or contested.
Do not write or edit any files.`

const checkPrompt = (r) => `You are an adversarial fact-checker for a popular science magazine. Your job is to find what is wrong, outdated, overstated or unsupported in another researcher's notes before they reach readers. ${TODAY}
Topic: ${TOPIC}. Angle: ${r.angle}.

For EVERY claim below, verify independently with WebSearch/WebFetch — do not trust the attached URL alone; open it or find a better primary source. Default to skepticism: if you cannot find reliable support, the verdict is unverifiable.
- confirmed: independent reliable sources support it as stated
- corrected: broadly right but a number, date, name or scope is wrong — give the right wording
- overstated: true kernel but exaggerated, oversimplified to the point of being misleading, or presents a single study/hypothesis as settled — give accurate wording
- disputed: reliable sources disagree
- unverifiable: no reliable source found
- false: evidence shows it is wrong
Return one verdict per claim, keeping ids unchanged.
Also verify each claim's basis. If the real evidence is weaker than stated (e.g. it was in mice, observational, or a preprint), the verdict is corrected or overstated and the corrected wording must name the real basis. Set consensus to where expert opinion stands — this is what lets the writer avoid false balance.

Also check the analogies (does any mislead in a way readers would carry away?) and the stories (apocryphal, misattributed, or unsourced? — e.g. famous science legends that historians reject).

<claims>
${JSON.stringify(r.claims.map(({ id, claim, basis, sources }) => ({ id, claim, basis, sources })), null, 1)}
</claims>

<analogies>
${r.analogies.join('\n')}
</analogies>

<stories>
${r.stories.join('\n')}
</stories>`

// Each angle goes straight from research into its own fact-check; no barrier between them.
phase('Investigate')
const investigated = (await pipeline(plan.angles,
  (a) => agent(researchPrompt(a), { label: `research:${a.key}`, phase: 'Investigate', schema: RESEARCH_SCHEMA }),
  (r, a) => r && agent(checkPrompt(r), { label: `fact-check:${a.key}`, phase: 'Investigate', schema: VERDICT_SCHEMA })
    .then(v => ({ ...r, key: a.key, check: v })),
)).filter(Boolean)

if (investigated.length < plan.angles.length) {
  const done = new Set(investigated.map(r => r.key))
  log(`Missing angles (agent failed or skipped): ${plan.angles.filter(a => !done.has(a.key)).map(a => a.key).join(', ')}`)
}
const unchecked = investigated.filter(r => !r.check).map(r => r.key)
if (unchecked.length) log(`Fact-check failed for: ${unchecked.join(', ')} — their claims stay marked unchecked`)

const verdictById = {}
for (const r of investigated) for (const v of r.check?.verdicts || []) verdictById[v.id] = v
const ledger = investigated.flatMap(r => r.claims.map(c => {
  const v = verdictById[c.id]
  return {
    id: c.id, angle: r.angle, claim: c.claim, kind: c.kind, importance: c.importance, basis: c.basis,
    verdict: v?.verdict || 'unchecked', corrected: v?.corrected || '', evidence: v?.evidence || '', consensus: v?.consensus || '',
    sources: [...(v?.sources || []), ...c.sources].slice(0, 3),
  }
}))
const tally = ledger.reduce((m, c) => ({ ...m, [c.verdict]: (m[c.verdict] || 0) + 1 }), {})
log(`Fact-check tally: ${JSON.stringify(tally)}`)

const usable = ledger.filter(c => ['confirmed', 'corrected', 'overstated', 'disputed'].includes(c.verdict))
const rejected = ledger.filter(c => !usable.includes(c))
const analogyIssues = investigated.flatMap(r => r.check?.analogyIssues || [])
const storyIssues = investigated.flatMap(r => r.check?.storyIssues || [])

const material = `<summaries>
${investigated.map(r => `## ${r.angle}\n${r.summary}\nOpen questions: ${r.openQuestions.join('; ')}`).join('\n\n')}
</summaries>

<usable_claims>
${JSON.stringify(usable.map(({ id, claim, kind, importance, basis, verdict, corrected, evidence, consensus, sources }) =>
  ({ id, claim, kind, importance, basis, verdict, corrected, consensus, sources, ...(verdict === 'disputed' && { evidence }) })), null, 1)}
</usable_claims>

<rejected_claims note="do NOT use these as facts">
${JSON.stringify(rejected.map(({ id, claim, verdict, evidence }) => ({ id, claim, verdict, evidence })), null, 1)}
</rejected_claims>

<analogies>
${investigated.flatMap(r => r.analogies).join('\n')}
</analogies>
<analogy_warnings>
${JSON.stringify(analogyIssues, null, 1)}
</analogy_warnings>

<stories>
${investigated.flatMap(r => r.stories).join('\n')}
</stories>
<story_warnings>
${storyIssues.join('\n')}
</story_warnings>

<misconceptions>
${investigated.flatMap(r => r.misconceptions).join('\n')}
</misconceptions>`

phase('Draft')
const draft = await agent(`You are an award-winning popular science writer. Write an article on "${TOPIC}" (working title: "${plan.workingTitle}").
Audience: ${AUDIENCE}. Language: ${LANG}. Length: ${LENGTH}.

Craft:
- Open with a concrete hook — a scene, a surprising fact, a question, or a story — not a definition or "since ancient times".
- Build understanding step by step; explain each idea before using it; at most a handful of technical terms, each defined in passing.
- Use analogies, but heed the analogy warnings and say where an analogy breaks down when it matters.
- Show how we know, not just what we know: the experiments, the people, the evidence.
- Answer the questions real readers would ask: ${plan.readerQuestions.join(' | ') || '(infer them)'}
- Bust at least one common misconception.
- Be honest about uncertainty: name what scientists still debate, without false balance.
- Numbers: give every percentage change or relative risk its baseline or absolute figure; prefer natural frequencies ("2 in 1,000") to percentages; give every very large or very small number a familiar scale.
- End with a resonant takeaway, not a summary.
- Use Markdown: a title, a one-sentence standfirst in italics, a few subheadings, short paragraphs.

Accuracy rules (non-negotiable):
- State as fact only claims from <usable_claims>. For "corrected" or "overstated" use the corrected wording. For "disputed", present the disagreement.
- Never use anything in <rejected_claims> as fact, and do not use stories flagged in <story_warnings>.
- When a claim's basis is animal, in-vitro, model, observational or a preprint, say so in the sentence. Use causal verbs ("causes", "prevents") only for rct or meta-analysis.
- For disputed claims, say which side the evidence favours (consensus); never present a minority view as an equal side.
- Every number, date, and named finding must trace to a usable claim. Mark each such sentence with a hidden tag like <!-- c:angle-3 --> so reviewers can trace it.

Return only the Markdown article.

${material}`, { label: 'draft', phase: 'Draft' })

phase('Review')
const [accuracy, reader] = await parallel([
  () => agent(`You are the accuracy editor. Check this popular science draft against the verified claim ledger. ${TODAY}
Flag every passage that: states something not supported by a usable claim; drifts from the corrected wording; turns a hedge into certainty or a correlation into causation; uses a rejected claim or flagged story; uses an analogy that would leave readers with a false picture; hides a weak basis (animal, in-vitro, model, observational, preprint) or uses causal verbs for anything but rct/meta-analysis; presents a disputed claim without saying which side the evidence favours, or gives a minority view equal weight; gives a relative change or percentage without its baseline; or simplifies so far it becomes wrong. You may use WebSearch to spot-check up to 5 high-stakes statements that lack a <!-- c:... --> tag.
Severity must-fix = a reader would come away believing something false.

<draft>
${draft}
</draft>

<ledger>
${JSON.stringify(ledger.map(({ id, claim, basis, verdict, corrected, consensus }) => ({ id, claim, basis, verdict, corrected, consensus })), null, 1)}
</ledger>
<analogy_warnings>
${JSON.stringify(analogyIssues, null, 1)}
</analogy_warnings>
<story_warnings>
${storyIssues.join('\n')}
</story_warnings>`, { label: 'review:accuracy', phase: 'Review', schema: REVIEW_SCHEMA }),
  () => agent(`You are the target reader: ${AUDIENCE}. You are smart but have no background in this subject, and you will stop reading the moment you get bored or lost.
Read the draft and flag: where you got lost or had to reread; jargon or undefined terms; jumps in logic; parts that drag; places you wanted an example or picture; questions the article raised but never answered; whether the opening hooked you and the ending landed. Quote exact passages.
Severity must-fix = you would stop reading here.

<draft>
${draft}
</draft>`, { label: 'review:reader', phase: 'Review', schema: REVIEW_SCHEMA }),
])
const mustFix = [...(accuracy?.issues || []), ...(reader?.issues || [])].filter(i => i.severity === 'must-fix').length
log(`Review: ${accuracy?.issues.length ?? 'n/a'} accuracy issues, ${reader?.issues.length ?? 'n/a'} readability issues, ${mustFix} must-fix`)

phase('Polish')
const final = await agent(`You are the senior editor giving this popular science article its final polish.
Audience: ${AUDIENCE}. Language: ${LANG}. Length: ${LENGTH}.

1. Fix every must-fix issue and every should-fix issue you agree with. Accuracy wins over style whenever they conflict; never reintroduce a claim the accuracy editor flagged.
2. Tighten prose: vary sentence rhythm, cut throat-clearing and filler, make verbs concrete, keep paragraphs short. Hedges and qualifiers ("in mice", "may", "one small study") are content, not filler — never cut them. Do not add facts, numbers or analogies that are not in the draft or ledger. Make the title and standfirst irresistible but honest — no clickbait that the article does not pay off.
3. Remove all <!-- c:... --> tags. Add a final "Sources & further reading" section listing the key sources (title + URL), drawn from the ledger.
4. Write the finished article with the Write tool to \`${ARTICLE}\` (create the directory if needed), and write the fact-check ledger as JSON to \`${OUT}/ledger.json\`. ${PATHS}
5. Return the path, title, standfirst, approximate word count (characters if Chinese), the main changes you made, and any caveats that remain.

<draft>
${draft}
</draft>

<accuracy_review>
${JSON.stringify(accuracy, null, 1)}
</accuracy_review>

<reader_review>
${JSON.stringify(reader, null, 1)}
</reader_review>

<ledger>
${JSON.stringify(ledger, null, 1)}
</ledger>`, { label: 'polish', phase: 'Polish', schema: FINAL_SCHEMA })

// Polish rewrites the title and prose after both reviews, so it gets its own gate.
phase('Verify')
const finalCheck = await agent(`You are the final accuracy gate for a popular science article. Read the article at \`${ARTICLE}\` and compare it with the reviewed draft and the claim ledger. ${PATHS} ${TODAY}
Flag only: (1) a title or standfirst that claims more than the body or ledger supports; (2) hedges or qualifiers present in the draft but dropped; (3) facts, numbers or analogies in neither the draft nor the ledger; (4) "Sources" entries whose URL is not in the ledger.
Severity must-fix = a reader would come away believing something false or stronger than the evidence.
Fix every must-fix issue in the file with the Edit tool, and summarise the edits you made in overall.

<draft>
${draft}
</draft>

<ledger>
${JSON.stringify(ledger.map(({ id, claim, verdict, corrected, sources }) => ({ id, claim, verdict, corrected, sources })), null, 1)}
</ledger>`, { label: 'verify:final', phase: 'Verify', schema: REVIEW_SCHEMA })
log(`Final gate: ${finalCheck?.issues.length ?? 'n/a'} issues, ${finalCheck?.issues.filter(i => i.severity === 'must-fix').length ?? 'n/a'} must-fix`)

return { version: VERSION, runTag: RUN_TAG, article: ARTICLE, ledger: `${OUT}/ledger.json`, tally, angles: plan.angles.map(a => a.key), final, finalCheck }
