import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'

type Options = { agentType?: string; label?: string }
type Agent = (prompt: string, options: Options) => Promise<unknown>
type Finding = { file: string; line: number; severity: string; problem: string; fix: string }
type Result = { confirmed: (Finding & { lens: string })[]; summary: string }

const SCRIPT = readFileSync(join(import.meta.dirname, '..', 'workflows', 'lens-review.js'), 'utf8').replace('export const meta', 'const meta')
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<Result>

function run(args: unknown, agent: Agent): Promise<Result> {
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk().catch(() => null)))
  const pipeline = (items: unknown[], first: (item: unknown) => Promise<unknown>, then: (result: unknown, item: unknown) => Promise<unknown>) =>
    Promise.all(items.map(async (item) => then(await first(item), item)))
  return new AsyncFunction('args', 'agent', 'parallel', 'pipeline', 'log', 'phase', SCRIPT)(
    args,
    agent,
    parallel,
    pipeline,
    () => undefined,
    () => undefined,
  )
}

const FINDING: Finding = { file: 'run.ts', line: 3, severity: 'blocker', problem: 'shell injection', fix: 'use execFileSync' }

test('starts one refute pass for each finding, and diffs a base ref against the merge base', async () => {
  const calls: Options[] = []
  const prompts: string[] = []
  await run({ baseRef: 'main' }, async (prompt, options) => {
    calls.push(options)
    prompts.push(prompt)
    if (options.label === 'review:slop' || options.label === 'review:tests') return { findings: [FINDING] }
    return options.label?.startsWith('review:') ? { findings: [] } : { real: true, why: 'x' }
  })
  assert.equal(calls.filter((call) => call.label?.startsWith('verify:')).length, 2)
  assert.ok(calls.every((call) => call.agentType === 'whetstone:whetstone-reviewer'))
  assert.ok(prompts.every((prompt) => prompt.includes('diff main...HEAD')))
})

test('runs every lens on the whetstone reviewer, with a spec lens only when a spec is given', async () => {
  const calls: Options[] = []
  const agent: Agent = async (_prompt, options) => {
    calls.push(options)
    return options.label?.startsWith('review:') ? { findings: [] } : { real: false, why: 'x' }
  }
  await run({}, agent)
  assert.deepEqual(
    calls.map((call) => call.label),
    ['review:slop', 'review:security', 'review:tests', 'review:smells'],
  )
  await run({ spec: 'docs/spec.md' }, agent)
  assert.equal(calls.filter((call) => call.label === 'review:spec').length, 1)
  assert.ok(calls.every((call) => call.agentType === 'whetstone:whetstone-reviewer'))
})

test('keeps only the findings the refute pass holds real, and says clean when none hold', async () => {
  const found = async (real: boolean) =>
    run({ baseRef: 'main' }, async (_prompt, options) => {
      if (options.label === 'review:security') return { findings: [FINDING] }
      if (options.label?.startsWith('review:')) return { findings: [] }
      return { real, why: 'checked' }
    })
  const held = await found(true)
  assert.deepEqual(
    held.confirmed.map(({ file, lens }) => ({ file, lens })),
    [{ file: 'run.ts', lens: 'security' }],
  )
  assert.match(held.summary, /^run\.ts:3 \[blocker\/security\] shell injection/)
  const refuted = await found(false)
  assert.deepEqual(refuted.confirmed, [])
  assert.equal(refuted.summary, 'REVIEW: clean')
})
