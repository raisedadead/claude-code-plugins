import { describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  type AgentBeforeSettleEvent,
} from '@earendil-works/pi-coding-agent'
import { claimReason, createClaimAdvisory } from '../pi/claims.ts'
import { verifyClaims, type Delegate } from '../pi/verify.ts'

const claim = (n = 1) => ({ claim: `claim ${n}`, source: `https://example.org/${n}` })
const verdict = (id: number, value = 'CONFIRMED', quote = 'source quote') => ({ id, verdict: value, quote, why: 'checked source' })
const answer: Delegate = async () => JSON.stringify({ verdicts: [verdict(1)] })
function boundary(text: string, outcome: AgentBeforeSettleEvent['outcome'] = 'completed'): AgentBeforeSettleEvent {
  return {
    type: 'agent_before_settle',
    outcome,
    continue: false,
    entries: [{ type: 'custom', customType: 'previous', data: 1 }],
    context: {
      contextEntries: [],
      llmMessages: [],
      pendingMessages: [],
      canContinue: true,
      contextMessages: [
        {
          role: 'assistant',
          content: [{ type: 'text', text }],
          api: 'anthropic-messages',
          provider: 'anthropic',
          model: 'fixture',
          stopReason: 'stop',
          timestamp: 0,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        },
      ],
    },
  }
}

describe('Pi claim advisory', () => {
  it('preserves entries and requests a model-visible correction once per run', () => {
    const gate = createClaimAdvisory()
    const event = boundary('The hook blocks unsafe edits.')
    const result = gate.beforeSettle(event)
    expect(result?.entries?.[0]).toBe(event.entries[0])
    expect(result?.entries?.[1]).toMatchObject({ type: 'custom_message', display: false, customType: 'whetstone-claim-advisory' })
    expect(result?.continue).toBe(true)
    expect(gate.beforeSettle(event)).toBeUndefined()
    gate.reset()
    expect(gate.beforeSettle(event)).toBeDefined()
  })
  it('skips aborted/error and backed or honestly labelled claims', () => {
    const gate = createClaimAdvisory()
    expect(gate.beforeSettle(boundary('The hook blocks unsafe edits.', 'aborted'))).toBeUndefined()
    expect(gate.beforeSettle(boundary('The hook blocks unsafe edits.', 'error'))).toBeUndefined()
    for (const text of [
      'The hook blocks unsafe edits (exit 1).',
      'The hook blocks unsafe edits (src/gate.ts:12).',
      'The hook is advisory.',
      'ordinary reply',
    ]) {
      expect(claimReason(text)).toBeUndefined()
    }
    expect(gate.beforeSettle(boundary('The hook blocks unsafe edits.'))).toBeDefined()
  })
  it('bounds sentences, Unicode codepoints and shown count like the hook', () => {
    const text = Array.from({ length: 15 }, () => `The hook blocks ${'😀'.repeat(200)}.`).join('\n')
    const reason = claimReason(text) ?? ''
    expect(reason.match(/line \d+:/g)).toHaveLength(10)
    expect(reason).toContain('… and 5 more')
    expect(reason).not.toContain('�')
    expect(reason).toContain('Then send the whole reply again')
  })
})

describe('native loader and runner', () => {
  it('loads the public entrypoint and chains boundary entries through real Pi dispatch', async () => {
    const temp = await mkdtemp(join(tmpdir(), 'whetstone-pi-'))
    try {
      const loaded = await discoverAndLoadExtensions([fileURLToPath(new URL('../pi/index.ts', import.meta.url))], temp, temp)
      expect(loaded.errors).toEqual([])
      expect(loaded.extensions).toHaveLength(1)
      const models = await ModelRuntime.create({
        authPath: join(temp, 'auth.json'),
        modelsPath: null,
        modelsStorePath: join(temp, 'models'),
        allowModelNetwork: false,
        refreshOnCreate: false,
      })
      const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, temp, SessionManager.inMemory(temp), new ModelRegistry(models))
      const errors: string[] = []
      runner.onError((error) => errors.push(error.error))
      const tool = runner.getToolDefinition('whetstone_verify_claims')
      expect(tool?.parameters).toMatchObject({ type: 'object' })
      await runner.emit({ type: 'session_start', reason: 'startup' })
      const event = boundary('The hook blocks unsafe edits.')
      const dispatch = () =>
        runner.emitBoundary({ type: 'agent_before_settle', outcome: 'completed' }, (entries) => {
          if (entries.length) expect(entries[0]).toMatchObject({ type: 'custom', customType: 'previous' })
          return event.context
        })
      const previous = loaded.extensions[0]
      expect(previous).toBeDefined()
      previous?.handlers.get('agent_before_settle')?.unshift(async () => ({ entries: event.entries }))
      const first = await dispatch()
      expect(first.valid).toBe(true)
      expect(first.entries).toHaveLength(2)
      expect(first.continue).toBe(true)
      expect((await dispatch()).entries).toHaveLength(1)
      await runner.emit({ type: 'agent_settled', aborted: false })
      expect((await dispatch()).entries).toHaveLength(2)
      await runner.emit({ type: 'session_start', reason: 'reload' })
      expect((await dispatch()).entries).toHaveLength(2)
      expect(errors).toEqual([])
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
})

describe('native verify-claims core', () => {
  it('verifies explicit claims with fresh artifact-only grounder missions and tallies model judgments', async () => {
    const delegate = vi.fn(answer)
    const result = await verifyClaims({ claims: [claim(), claim(2)], batch: 1 }, delegate)
    expect(result.tally).toEqual({ CONFIRMED: 2 })
    expect(delegate).toHaveBeenCalledTimes(2)
    expect(delegate.mock.calls[0]?.[0]).toBe('whetstone-grounder')
    expect(delegate.mock.calls[0]?.[1]).toContain('Return JSON only')
    expect(delegate.mock.calls[0]?.[1]).not.toContain('claim 2')
    expect(result.enforcement).toBe('model-judgment')
  })
  it('gathers, validates and deduplicates scouts independently of dossier', async () => {
    const delegate: Delegate = async (agent) =>
      agent === 'whetstone-scout' ? JSON.stringify({ claims: [{ ...claim(), date: '', primary: true }], gaps: ['unknown date'] }) : answer(agent, '')
    const result = await verifyClaims({ question: 'what is current?', scouts: 4 }, delegate)
    expect(result.claims).toHaveLength(1)
    expect(result.tally).toEqual({ CONFIRMED: 1 })
    expect(result.gaps).toContain('unknown date')
  })
  it.each([
    { verdicts: [verdict(1, 'INVENTED')] },
    { verdicts: [verdict(1, 'CONFIRMED', ' ')] },
    { verdicts: [verdict(1), verdict(1)] },
    { verdicts: [verdict(2)] },
    { verdicts: [{ id: 1, verdict: 'CONFIRMED', quote: 'quote' }] },
    { verdicts: [verdict('1' as unknown as number)] },
    {},
  ])('fails uncertain verdicts to UNRULED: %j', async (payload) => {
    const result = await verifyClaims({ claims: [claim()] }, async () => JSON.stringify(payload))
    expect(result.tally).toEqual({ UNRULED: 1 })
    expect(result.claims[0]?.quote).toBe('')
  })
  it.each(['CONFIRMED', 'UNSUPPORTED', 'CONTRADICTED', 'SOURCE-DEAD'])('retains a valid %s model judgment', async (value) => {
    const result = await verifyClaims({ claims: [claim()] }, async () => JSON.stringify({ verdicts: [verdict(1, value)] }))
    expect(result.tally).toEqual({ [value]: 1 })
  })
  it('handles malformed JSON and delegate failure without confirming claims', async () => {
    for (const delegate of [
      async () => '```json\n{}\n```',
      async () => {
        throw new Error('failed')
      },
    ]) {
      expect((await verifyClaims({ claims: [claim()] }, delegate)).tally).toEqual({ UNRULED: 1 })
      expect((await verifyClaims({ question: 'question' }, delegate)).claims).toEqual([])
    }
  })
  it('rejects malformed scout objects instead of coercing evidence', async () => {
    for (const value of [null, { claim: 'claim', source: 42 }, { ...claim(), primary: 'true' }]) {
      const result = await verifyClaims({ question: 'q', scouts: 1 }, async () => JSON.stringify({ claims: [value] }))
      expect(result.claims).toEqual([])
      expect(result.error).toBeDefined()
    }
  })
  it('times out an uncooperative delegate and leaves its batch UNRULED', async () => {
    vi.useFakeTimers()
    try {
      const result = verifyClaims({ claims: [claim()] }, async () => new Promise<string>(() => {}))
      await vi.advanceTimersByTimeAsync(120000)
      expect((await result).tally).toEqual({ UNRULED: 1 })
    } finally {
      vi.useRealTimers()
    }
  })
  it('cancels promptly even when a delegate ignores the abort signal', async () => {
    const controller = new AbortController()
    const result = verifyClaims({ claims: [claim()] }, async () => new Promise<string>(() => {}), controller.signal)
    controller.abort()
    await expect(result).rejects.toThrow()
  })
  it('bounds scout counts and integer batch sizes', async () => {
    const delegate = vi.fn(answer)
    await verifyClaims({ claims: Array.from({ length: 11 }, (_, i) => claim(i)), batch: 100 }, delegate)
    expect(delegate).toHaveBeenCalledTimes(2)
    delegate.mockClear()
    await verifyClaims({ question: 'q', scouts: 100 }, delegate)
    expect(delegate).toHaveBeenCalledTimes(4)
  })
  it('rejects invalid input and excessive work before delegation', async () => {
    const delegate = vi.fn(answer)
    for (const input of [{}, { question: ' ' }, { claims: [{ claim: '', source: 'x' }] }, { claims: Array.from({ length: 101 }, () => claim()) }]) {
      await expect(verifyClaims(input, delegate)).rejects.toThrow()
    }
    expect(delegate).not.toHaveBeenCalled()
  })
  it('propagates cancellation and starts no more batches', async () => {
    const controller = new AbortController()
    const delegate = vi.fn<Delegate>(async (_agent, _task, signal) => {
      expect(signal?.aborted).toBe(false)
      controller.abort()
      expect(signal?.aborted).toBe(true)
      return JSON.stringify({ verdicts: [verdict(1)] })
    })
    await expect(verifyClaims({ claims: [claim(), claim(2)], batch: 1 }, delegate, controller.signal)).rejects.toThrow()
    expect(delegate).toHaveBeenCalledTimes(1)
    await expect(verifyClaims({ claims: [claim()] }, delegate, controller.signal)).rejects.toThrow()
  })
})
