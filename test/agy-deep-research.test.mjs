import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadWorkflow, runWorkflow } from './harness.mjs'

const WF = new URL('../.claude/workflows/agy-deep-research.js', import.meta.url).pathname

// Passing angles skips the Plan agent and uses BUSINESS_PROFILE.
const args = { topic: 'AI 陪伴硬件创业', angles: [{ key: 'market', title: '市场', focus: '需求' }] }

const fake = () => (prompt, { label }) => {
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

test('agy: default outputs are relative to the project root', async () => {
  const { result, calls } = await runWorkflow(WF, args, fake())
  assert.equal(result.report, 'reports/ai-陪伴硬件创业.md')
  assert.equal(result.rawDir, 'research_notes/agy-deep-research/ai-陪伴硬件创业/raw')
  for (const { prompt } of calls) assert.doesNotMatch(prompt, /\/Users\//)
})
