import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { createDelegate, type DelegateSession, type DelegateContext, type DelegateFactory } from '../../hosts/pi/delegate.ts'

const model: NonNullable<ExtensionContext['model']> = {
  id: 'test/model',
  name: 'Test',
  provider: 'test',
  api: 'anthropic-messages',
  baseUrl: 'https://invalid.example',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
}
const dirs: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function fixture(agent = 'dossier-reviewer') {
  const root = await mkdtemp(join(tmpdir(), 'delegate-test-'))
  dirs.push(root)
  await mkdir(join(root, 'agents'))
  await mkdir(join(root, 'pi'))
  await writeFile(join(root, 'pi/guards.ts'), 'export default function register() {}\n')
  await writeFile(join(root, 'agents', `${agent}.md`), '---\nmodel: ignored-claude-alias\ntools: Read\n---\nIndependent agent body.\n')
  const ctx: DelegateContext = {
    cwd: root,
    model,
    signal: undefined,
    modelRegistry: { find: vi.fn(() => model), getProviderAuth: vi.fn(async () => undefined), getProvider: vi.fn(() => undefined) },
  }
  const options = { plugin: 'dossier' as const, root, agent, task: 'Inspect the artifact only.' }
  return { root, ctx, options }
}
function child(text = 'REVIEW: PASS', stopReason = 'stop' as 'stop' | 'error' | 'aborted' | 'length' | 'toolUse') {
  const unsubscribe = vi.fn()
  const session: DelegateSession = {
    model,
    sessionId: 'child-id',
    messages: [],
    subscribe: vi.fn(() => unsubscribe),
    prompt: vi.fn(async () => {
      session.messages.push({
        role: 'assistant',
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [{ type: 'text', text }],
        stopReason,
        errorMessage: stopReason === 'error' ? 'provider failed' : undefined,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        timestamp: 0,
      })
    }),
    abort: vi.fn(async () => {}),
    dispose: vi.fn(),
  }
  const factory = vi.fn<DelegateFactory>(async () => ({ session }))
  return { session, factory, unsubscribe }
}

describe('fresh-context delegation', () => {
  it('uses only the artifact mission, isolated resources/settings/history and qualified result', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    const result = await createDelegate(c.factory)(ctx, options)
    expect(result).toEqual({ text: 'REVIEW: PASS', agent: 'dossier:dossier-reviewer', id: 'child-id' })
    const config = c.factory.mock.calls[0][0]
    expect(config.cwd).toBe(ctx.cwd)
    expect(config.model).toBe(model)
    expect(config.sessionManager?.getSessionFile()).toBeUndefined()
    expect(config.sessionManager?.getEntries()).toEqual([])
    expect(config.settingsManager?.getSettings().retry?.enabled).toBe(false)
    expect(config.resourceLoader?.getExtensions().extensions).toEqual([])
    expect(config.resourceLoader?.getAgentsFiles().agentsFiles).toEqual([])
    const prompt = config.resourceLoader?.getSystemPrompt()
    expect(prompt).toContain('Independent agent body.')
    expect(prompt).not.toContain('ignored-claude-alias')
    expect(prompt).toContain('prompt-only')
    expect(c.session.prompt).toHaveBeenCalledWith(options.task, { expandPromptTemplates: false })
    expect(c.unsubscribe).toHaveBeenCalledOnce()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
  it.each(['../dossier-reviewer', '/tmp/reviewer', 'reviewer', 'whetstone-doubter'])('rejects unknown or traversal agent %s', async (agent) => {
    const { ctx, options } = await fixture()
    const c = child()
    await expect(createDelegate(c.factory)(ctx, { ...options, agent })).rejects.toThrow(/Unknown agent/)
    expect(c.factory).not.toHaveBeenCalled()
  })
  it('rejects named-agent writes, empty missions and malformed frontmatter', async () => {
    const { ctx, options, root } = await fixture()
    const c = child()
    const run = createDelegate(c.factory)
    await expect(run(ctx, { ...options, write: true })).rejects.toThrow(/general-purpose/)
    await expect(run(ctx, { ...options, task: ' ' })).rejects.toThrow(/task/i)
    await writeFile(join(root, 'agents/dossier-reviewer.md'), '---\nunclosed')
    await expect(run(ctx, options)).rejects.toThrow(/frontmatter/i)
    expect(c.factory).not.toHaveBeenCalled()
  })
  it.each([
    ['dossier', 'dossier-scout', ['read', 'grep', 'find', 'bash']],
    ['dossier', 'dossier-reviewer', ['read', 'grep', 'find', 'bash']],
    ['whetstone', 'whetstone-doubter', ['read', 'grep', 'find']],
    ['whetstone', 'whetstone-scout', ['read', 'grep', 'find', 'bash']],
    ['whetstone', 'whetstone-grounder', ['read', 'grep', 'find', 'bash']],
  ] as const)('restricts %s %s tools', async (plugin, agent, tools) => {
    const { ctx, options } = await fixture(agent)
    const c = child()
    await createDelegate(c.factory)(ctx, { ...options, plugin })
    expect(c.factory.mock.calls[0][0].tools).toEqual(tools)
  })
  it('grants builder edit/write only on explicit opt-in and never calls it reviewer', async () => {
    const { ctx, options } = await fixture()
    const c = child('built')
    const run = createDelegate(c.factory)
    const result = await run(ctx, { ...options, agent: 'general-purpose' })
    expect(result.agent).toBe('dossier:general-purpose')
    expect(c.factory.mock.calls[0][0].tools).not.toContain('write')
    await run(ctx, { ...options, agent: 'general-purpose', write: true })
    expect(c.factory.mock.calls[1][0].tools).toEqual(['read', 'grep', 'find', 'bash', 'edit', 'write'])
    expect(c.factory.mock.calls[1][0].sessionManager).not.toBe(c.factory.mock.calls[0][0].sessionManager)
  })
  it('resolves only explicit provider/model and fails without a model', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    const run = createDelegate(c.factory)
    await run(ctx, { ...options, model: 'test/test/model' })
    expect(ctx.modelRegistry.find).toHaveBeenCalledWith('test', 'test/model')
    await expect(run(ctx, { ...options, model: 'sonnet' })).rejects.toThrow(/provider\/model/)
    await expect(run({ ...ctx, model: undefined }, options)).rejects.toThrow(/model/i)
    ctx.modelRegistry.find = () => undefined
    await expect(run(ctx, { ...options, model: 'other/missing' })).rejects.toThrow(/Unknown model/)
  })
  it.each([
    ['', 'stop'],
    ['partial', 'error'],
    ['partial', 'aborted'],
    ['partial', 'length'],
    ['partial', 'toolUse'],
  ] as const)('never succeeds with text=%s stop=%s', async (text, stop) => {
    const { ctx, options } = await fixture()
    const c = child(text, stop)
    await expect(createDelegate(c.factory)(ctx, options)).rejects.toThrow()
    expect(c.unsubscribe).toHaveBeenCalledOnce()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
  it('propagates prompt failure and disposes', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    c.session.prompt = vi.fn(async () => {
      throw new Error('bad credentials')
    })
    await expect(createDelegate(c.factory)(ctx, options)).rejects.toThrow('bad credentials')
    expect(c.unsubscribe).toHaveBeenCalledOnce()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
  it('aborts promptly even if child prompt and abort never resolve', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    c.session.prompt = vi.fn(() => {
      started()
      return new Promise<void>(() => {})
    })
    c.session.abort = vi.fn(() => new Promise<void>(() => {}))
    const result = createDelegate(c.factory)(ctx, { ...options, signal: controller.signal })
    const assertion = expect(result).rejects.toThrow(/abort/i)
    await ready
    controller.abort()
    await assertion
    expect(c.session.abort).toHaveBeenCalledOnce()
    expect(c.unsubscribe).toHaveBeenCalledOnce()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
  it('does not create an already-cancelled mission', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    await expect(createDelegate(c.factory)(ctx, { ...options, signal: AbortSignal.abort() })).rejects.toThrow(/abort/i)
    expect(c.factory).not.toHaveBeenCalled()
  })
  it('rejects missing/fallback child model and disposes before prompting', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    c.factory.mockResolvedValue({ session: { ...c.session, model: undefined } })
    await expect(createDelegate(c.factory)(ctx, options)).rejects.toThrow(/model/i)
    expect(c.session.prompt).not.toHaveBeenCalled()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
  it('rejects prompt symlinks escaping the plugin root', async () => {
    const { ctx, options, root } = await fixture()
    const c = child()
    const outside = await mkdtemp(join(tmpdir(), 'delegate-outside-'))
    dirs.push(outside)
    await writeFile(join(outside, 'agent.md'), 'outside')
    await rm(join(root, 'agents/dossier-reviewer.md'))
    await symlink(join(outside, 'agent.md'), join(root, 'agents/dossier-reviewer.md'))
    await expect(createDelegate(c.factory)(ctx, options)).rejects.toThrow(/escapes/)
    expect(c.factory).not.toHaveBeenCalled()
  })
  it('strips empty frontmatter', async () => {
    const { ctx, options, root } = await fixture()
    const c = child()
    await writeFile(join(root, 'agents/dossier-reviewer.md'), '---\n---\nBody without metadata.')
    await createDelegate(c.factory)(ctx, options)
    expect(c.factory.mock.calls[0][0].resourceLoader?.getSystemPrompt()).toContain('Body without metadata.')
  })
  it('disposes a session created after cancellation without prompting', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    const controller = new AbortController()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    let finish!: (result: { session: DelegateSession }) => void
    c.factory.mockImplementation(() => {
      started()
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const result = createDelegate(c.factory)(ctx, { ...options, signal: controller.signal })
    const assertion = expect(result).rejects.toThrow(/abort/i)
    await ready
    controller.abort()
    await assertion
    finish({ session: c.session })
    await Promise.resolve()
    await Promise.resolve()
    expect(c.session.dispose).toHaveBeenCalledOnce()
    expect(c.session.prompt).not.toHaveBeenCalled()
  })
  it('fails clearly when the public registry cannot expose a provider', async () => {
    const { ctx, options } = await fixture()
    await expect(createDelegate()(ctx, options)).rejects.toThrow(/Cannot inherit provider.*no provider fallback/)
  })
  it('bounds a child that never completes', async () => {
    const { ctx, options } = await fixture()
    const c = child()
    let started!: () => void
    const ready = new Promise<void>((resolve) => {
      started = resolve
    })
    c.session.prompt = vi.fn(() => {
      started()
      return new Promise<void>(() => {})
    })
    vi.useFakeTimers()
    const result = createDelegate(c.factory, 20)(ctx, options)
    const assertion = expect(result).rejects.toThrow(/timed out/i)
    await ready
    await vi.advanceTimersByTimeAsync(20)
    await assertion
    expect(c.session.abort).toHaveBeenCalledOnce()
    expect(c.session.dispose).toHaveBeenCalledOnce()
  })
})
