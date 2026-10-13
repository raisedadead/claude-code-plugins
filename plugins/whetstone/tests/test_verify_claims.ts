import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'

type Call = { prompt: string; options: { agentType?: string } }
type Agent = (prompt: string, options: { agentType?: string }) => Promise<unknown>
type Result = { claims?: { verdict: string }[]; tally?: Record<string, number>; error?: string }

const SCRIPT = readFileSync(join(import.meta.dirname, '..', 'workflows', 'verify-claims.js'), 'utf8').replace('export const meta', 'const meta')
const AsyncFunction = Object.getPrototypeOf(async () => undefined).constructor as new (...names: string[]) => (...values: unknown[]) => Promise<Result>

function run(args: unknown, agent: Agent): Promise<Result> {
  const parallel = (thunks: (() => Promise<unknown>)[]): Promise<unknown[]> => Promise.all(thunks.map((thunk) => thunk().catch(() => null)))
  return new AsyncFunction('args', 'agent', 'parallel', 'log', 'phase', SCRIPT)(
    args,
    agent,
    parallel,
    () => undefined,
    () => undefined,
  )
}

function claims(n: number): { claim: string; source: string }[] {
  return Array.from({ length: n }, (_, i) => ({ claim: `claim ${i + 1}`, source: `https://example.com/${i + 1}` }))
}

function ids(prompt: string): number[] {
  return [...prompt.matchAll(/^(\d+)\. CLAIM:/gm)].map((match) => Number(match[1]))
}

test('sends the claims to grounders in batches and rules on every claim', async () => {
  const calls: Call[] = []
  const result = await run({ claims: claims(12) }, async (prompt, options) => {
    calls.push({ prompt, options })
    return { verdicts: ids(prompt).map((id) => ({ id, verdict: 'CONFIRMED', quote: 'q', why: 'says so' })) }
  })
  assert.deepEqual(
    calls.map((call) => ids(call.prompt).length),
    [5, 5, 2],
  )
  assert.ok(calls.every((call) => call.options.agentType === 'whetstone:whetstone-grounder'))
  assert.deepEqual(result.tally, { CONFIRMED: 12 })
})

test('marks a claim the grounder skipped, or a failed batch, as unruled', async () => {
  let batch = 0
  const result = await run({ claims: claims(7), batch: 3 }, async (prompt) => {
    batch += 1
    if (batch === 2) throw new Error('agent died')
    return { verdicts: ids(prompt).flatMap((id) => (id === 2 ? [] : [{ id, verdict: 'CONFIRMED', quote: 'q', why: 'says so' }])) }
  })
  assert.equal(result.claims?.length, 7)
  assert.deepEqual(result.tally, { CONFIRMED: 3, UNRULED: 4 })
})

test('refuses to run with neither a question nor claims', async () => {
  const result = await run({}, async () => assert.fail('no agent may start'))
  assert.match(result.error ?? '', /args.question or args.claims/)
})

test('treats a verdict with no quote, or a grounder that returns nothing, as no ruling', async () => {
  let batch = 0
  const result = await run({ claims: claims(4), batch: 2 }, async (prompt) => {
    batch += 1
    if (batch === 2) return null
    return { verdicts: ids(prompt).map((id) => ({ id, verdict: 'CONFIRMED', quote: id === 1 ? ' ' : 'q', why: 'says so' })) }
  })
  assert.deepEqual(result.tally, { CONFIRMED: 1, UNRULED: 3 })
})
