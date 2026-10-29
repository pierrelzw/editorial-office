// Runs a Claude Code workflow script under Node with stubbed hooks, so the
// orchestration (data flow, prompts, paths) can be tested without spending tokens.
import { readFileSync } from 'node:fs'

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor

export function loadWorkflow(path) {
  const src = readFileSync(path, 'utf8')
  // The harness treats `export const meta` as a plain declaration and the body as an async function (top-level return is legal).
  const body = src.replace(/^export const meta\s*=/m, 'const meta =')
  const fn = new AsyncFunction('args', 'agent', 'phase', 'log', 'pipeline', 'parallel', 'budget', 'workflow', 'Date', 'Math', body)
  const literal = src.match(/^export const meta\s*=\s*(\{[\s\S]*?\n\})/m)
  if (!literal) throw new Error(`${path}: no \`export const meta = {...}\` block`)
  const meta = new Function(`return (${literal[1]})`)()
  return { meta, fn }
}

// Mirrors the real runtime: a stage that throws drops its item to null; parallel never rejects.
const pipeline = (items, ...stages) => Promise.all(items.map(async (item, i) => {
  let prev = item
  try {
    for (const stage of stages) prev = await stage(prev, item, i)
    return prev
  } catch { return null }
}))
const parallel = (thunks) => Promise.all(thunks.map(t => Promise.resolve().then(t).catch(() => null)))

// The real runtime forbids these because they break resume; fail loudly if a script uses them.
const StrictDate = new Proxy(Date, {
  construct(target, a) { if (!a.length) throw new Error('new Date() without arguments is not allowed in workflows'); return new target(...a) },
  get(target, k) { if (k === 'now') return () => { throw new Error('Date.now() is not allowed in workflows') }; return Reflect.get(target, k) },
})
const StrictMath = new Proxy(Math, {
  get(target, k) { if (k === 'random') return () => { throw new Error('Math.random() is not allowed in workflows') }; return Reflect.get(target, k) },
})

// respond(prompt, opts) returns the fake agent result; every call is recorded in `calls`.
export async function runWorkflow(path, args, respond) {
  const { fn } = loadWorkflow(path)
  const calls = [], logs = [], phases = []
  const agent = async (prompt, opts = {}) => {
    calls.push({ prompt, opts })
    return respond(prompt, opts)
  }
  const budget = { total: null, spent: () => 0, remaining: () => Infinity }
  const workflow = () => { throw new Error('nested workflow() is not stubbed') }
  const result = await fn(args, agent, (t) => phases.push(t), (m) => logs.push(m), pipeline, parallel, budget, workflow, StrictDate, StrictMath)
  return { result, calls, logs, phases }
}
