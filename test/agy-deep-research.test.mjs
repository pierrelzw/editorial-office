import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadWorkflow, runWorkflow } from './harness.mjs'

const WF = new URL('../.claude/workflows/agy-deep-research.js', import.meta.url).pathname
const VERSION = readFileSync(WF, 'utf8').match(/^const VERSION = '([^']+)'/m)[1]

// Passing angles skips the Plan agent and uses BUSINESS_PROFILE.
const args = { topic: 'AI 陪伴硬件创业', angles: [{ key: 'market', title: '市场', focus: '需求' }] }

const fake = () => (prompt, { label }) => {
  if (label === 'slug') return { slug: 'ai-companion-hardware' }
  if (label.startsWith('agy:')) return {
    angle: label.slice(4), agyStatus: 'completed', rawPath: 'r', summary: 's', openQuestions: [],
    claims: [{ id: 'market-1', claim: 'c', kind: 'number', importance: 3, sources: [] }],
  }
  if (label === 'cross-angle-logic') return { contradictions: [], hypeFlags: [], gaps: [] }
  if (label.startsWith('verify:')) return { verdicts: [{ id: 'market-1', verdict: 'confirmed', corrected: '', evidence: 'e', sources: [] }], notes: '' }
  if (label === 'synthesize') return '# Draft'
  if (label === 'red-team') return 'done'
  throw new Error(`unexpected agent label ${label}`)
}

test('agy: meta phases match the phase() calls', async () => {
  const { meta } = loadWorkflow(WF)
  const { phases } = await runWorkflow(WF, args, fake())
  assert.deepEqual(meta.phases.map(p => p.title), phases)
})

test('agy: requires a topic', async () => {
  await assert.rejects(runWorkflow(WF, {}, fake()), /args\.topic/)
})

test('agy: outputs are project-relative, English and keyed by version and runTag', async () => {
  const { result, calls } = await runWorkflow(WF, { ...args, runTag: 'R1' }, fake())
  assert.equal(result.report, `reports/ai-companion-hardware/${VERSION}-r1.md`)
  assert.equal(result.ledger, `research_notes/agy-deep-research/ai-companion-hardware/${VERSION}-r1/ledger.json`)
  assert.equal(result.rawDir, `research_notes/agy-deep-research/ai-companion-hardware/${VERSION}-r1/raw`)
  for (const { prompt } of calls) assert.doesNotMatch(prompt, /\/Users\//)
  for (const { prompt } of calls) assert.doesNotMatch(prompt, /(reports|research_notes\/agy-deep-research)\/[a-z0-9-]*[^\x00-\x7f]/)
})

test('agy: args.slug skips the slug agent; untagged runs warn about overwriting', async () => {
  const { result, calls, logs } = await runWorkflow(WF, { ...args, slug: 'AI Companions' }, fake())
  assert.equal(result.report, `reports/ai-companions/${VERSION}-untagged.md`)
  assert.ok(!calls.some(c => c.opts.label === 'slug'))
  assert.ok(logs.some(l => /覆盖/.test(l)))
})
