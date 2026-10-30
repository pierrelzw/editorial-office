import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadWorkflow, runWorkflow } from './harness.mjs'

const WF = new URL('../.claude/workflows/popular-science.js', import.meta.url).pathname
const VERSION = readFileSync(WF, 'utf8').match(/^const VERSION = '([^']+)'/m)[1]

const plan = {
  workingTitle: 'Dreams',
  angles: [
    { key: 'core', title: 'Core science', focus: 'mechanism' },
    { key: 'myth', title: 'Myths', focus: 'misconceptions' },
  ],
  readerQuestions: ['Why do we forget dreams?'],
}
const research = (key) => ({
  angle: key,
  summary: `summary of ${key}`,
  claims: [1, 2, 3].map(n => ({
    id: `${key}-${n}`, claim: `${key} claim ${n}`, kind: 'mechanism', importance: 2,
    basis: { design: 'observational', subjects: '100 adults', status: 'peer-reviewed' },
    sources: [`https://example.org/${key}/${n}`],
  })),
  analogies: [`${key} analogy`], stories: [`${key} story`], misconceptions: [`${key} myth`], openQuestions: ['?'],
})
// n=1 confirmed, n=2 false, n=3 missing from the verdicts → unchecked.
const verdicts = (key) => ({
  verdicts: [
    { id: `${key}-1`, verdict: 'confirmed', corrected: '', evidence: 'ok', consensus: 'strong', sources: ['https://checker.org/1'] },
    { id: `${key}-2`, verdict: 'false', corrected: 'nope', evidence: 'refuted', consensus: 'strong', sources: [] },
  ],
  analogyIssues: [], storyIssues: [`${key} story is apocryphal`],
})
const review = { issues: [{ quote: 'x', problem: 'y', fix: 'z', severity: 'must-fix' }], overall: 'ok' }

const fake = ({ failResearch = [] } = {}) => (prompt, { label }) => {
  const [stage, key] = label.split(':')
  if (label === 'plan') return plan
  if (label === 'slug') return { slug: 'Why We Dream' }
  if (stage === 'research') return failResearch.includes(key) ? null : research(key)
  if (stage === 'fact-check') return verdicts(key)
  if (label === 'draft') return '# Draft <!-- c:core-1 -->'
  if (stage === 'review') return review
  if (label === 'polish') return { path: 'p', title: 't', standfirst: 's', wordCount: 1, changes: [], remainingCaveats: [] }
  if (label === 'verify:final') return { issues: [], overall: 'clean' }
  throw new Error(`unexpected agent label ${label}`)
}
// Prompts also mention tags inline ("claims from <usable_claims>"), so match only a block whose opening tag ends its line.
const section = (prompt, tag) => prompt.match(new RegExp(`<${tag}[^>]*>\\n([\\s\\S]*?)\\n</${tag}>`))[1]

test('meta phases match the phase() calls', async () => {
  const { meta } = loadWorkflow(WF)
  const { phases } = await runWorkflow(WF, { topic: 'Why do we dream?', runTag: 't' }, fake())
  assert.deepEqual(meta.phases.map(p => p.title), phases)
})

test('requires a topic', async () => {
  await assert.rejects(runWorkflow(WF, {}, fake()), /args\.topic/)
})

test('paths are project-relative and keyed by version and runTag', async () => {
  const { result, calls } = await runWorkflow(WF, { topic: '为什么我们会做梦？', runTag: 'First Try' }, fake())
  assert.equal(result.article, `articles/why-we-dream/${VERSION}-first-try.md`)
  assert.equal(result.ledger, `research_notes/popular-science/why-we-dream/${VERSION}-first-try/ledger.json`)
  const polish = calls.find(c => c.opts.label === 'polish').prompt
  assert.match(polish, /project root/)
  assert.ok(polish.includes(result.article) && polish.includes(result.ledger))
})

test('only usable claims reach the writer as facts', async () => {
  const { result, calls } = await runWorkflow(WF, { topic: 'Dreams', runTag: 't' }, fake())
  assert.deepEqual(result.tally, { confirmed: 2, false: 2, unchecked: 2 })
  const draft = calls.find(c => c.opts.label === 'draft').prompt
  const usable = JSON.parse(section(draft, 'usable_claims'))
  assert.deepEqual(usable.map(c => c.id), ['core-1', 'myth-1'])
  const rejected = JSON.parse(section(draft, 'rejected_claims'))
  assert.deepEqual(rejected.map(c => c.id).sort(), ['core-2', 'core-3', 'myth-2', 'myth-3'])
  assert.match(section(draft, 'story_warnings'), /core story is apocryphal/)
})

test('ledger merges checker sources first, capped at 3', async () => {
  const { calls } = await runWorkflow(WF, { topic: 'Dreams', runTag: 't' }, fake())
  const polish = calls.find(c => c.opts.label === 'polish').prompt
  const ledger = JSON.parse(section(polish, 'ledger'))
  const core1 = ledger.find(c => c.id === 'core-1')
  assert.deepEqual(core1.sources, ['https://checker.org/1', 'https://example.org/core/1'])
  assert.equal(ledger.find(c => c.id === 'core-3').verdict, 'unchecked')
})

test('a failed researcher drops its angle without breaking the run', async () => {
  const { result, calls, logs } = await runWorkflow(WF, { topic: 'Dreams', runTag: 't' }, fake({ failResearch: ['myth'] }))
  assert.ok(!calls.some(c => c.opts.label === 'fact-check:myth'))
  assert.ok(logs.some(l => /Missing angles.*myth/.test(l)))
  assert.deepEqual(result.tally, { confirmed: 1, false: 1, unchecked: 1 })
})

test('args.angles skips the planning agent', async () => {
  const { calls, result } = await runWorkflow(WF, { topic: 'Dreams', runTag: 't', angles: plan.angles }, fake())
  assert.ok(!calls.some(c => c.opts.label === 'plan'))
  assert.deepEqual(result.angles, ['core', 'myth'])
})

test('untagged runs warn about overwriting', async () => {
  const { logs, result } = await runWorkflow(WF, { topic: 'Dreams' }, fake())
  assert.equal(result.runTag, 'untagged')
  assert.ok(logs.some(l => /overwrite/.test(l)))
})

test('file names are English: non-ASCII topics get a generated slug', async () => {
  const { calls, logs } = await runWorkflow(WF, { topic: '为什么我们会做梦？' }, fake())
  const slug = calls.find(c => c.opts.label === 'slug')
  assert.ok(slug && slug.opts.model === 'haiku' && slug.opts.effort === 'low')
  const polish = calls.find(c => c.opts.label === 'polish').prompt
  assert.match(polish, new RegExp(`articles/why-we-dream/${VERSION}-untagged\\.md`))
  assert.ok(logs.some(l => /args\.slug: "why-we-dream"/.test(l)))
  for (const { prompt } of calls) assert.doesNotMatch(prompt, /(articles|research_notes\/popular-science)\/[a-z0-9-]*[^\x00-\x7f]/)
})

test('an ASCII topic or args.slug needs no slug agent', async () => {
  const ascii = await runWorkflow(WF, { topic: 'Why do we dream? A café story', runTag: 't' }, fake())
  assert.equal(ascii.result.slug, 'why-do-we-dream-a-cafe-story')
  assert.ok(!ascii.calls.some(c => c.opts.label === 'slug'))
  const given = await runWorkflow(WF, { topic: '为什么我们会做梦？', slug: 'Dreams 101', runTag: 't' }, fake())
  assert.equal(given.result.slug, 'dreams-101')
  assert.ok(!given.calls.some(c => c.opts.label === 'slug'))
})

test('slugs are capped at 60 characters on a word boundary', async () => {
  const { result } = await runWorkflow(WF, { topic: 'quantum '.repeat(10), runTag: 't' }, fake())
  assert.equal(result.slug, 'quantum-'.repeat(6) + 'quantum')
  const long = await runWorkflow(WF, { topic: 'x'.repeat(80), runTag: 't' }, fake())
  assert.equal(long.result.slug, 'x'.repeat(60))
})

test('a non-English slug or runTag is rejected before any agent runs', async () => {
  let spawned = 0
  const respond = (...a) => { spawned++; return fake()(...a) }
  await assert.rejects(runWorkflow(WF, { topic: 'Dreams', slug: '做梦' }, respond), /args\.slug must be English/)
  await assert.rejects(runWorkflow(WF, { topic: 'Dreams', runTag: '第一次' }, respond), /args\.runTag must be English/)
  assert.equal(spawned, 0)
})
