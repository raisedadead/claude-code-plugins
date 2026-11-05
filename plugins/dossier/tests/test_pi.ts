import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DefaultResourceLoader,
  createEditTool,
  createWriteTool,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type SessionBoundaryDraft,
  type ToolCallEvent,
  type ToolResultEvent,
} from '@earendil-works/pi-coding-agent'
import register, { registerRuntime } from '../pi/index.ts'
import { nativeIo, runBounded } from '../pi/io.ts'
import { normalizeMutation, skillFromPath, skillName } from '../pi/normalize.ts'
import type { Io } from '../hooks/gates.ts'

const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((p) => rm(p, { recursive: true, force: true })))
})
async function temp() {
  const p = await mkdtemp(join(tmpdir(), 'dossier-pi-'))
  temps.push(p)
  return p
}
const ledger =
  '`2026-01-01` · `live`\n\n## §T Tasks\n| id | state | who | needs | task | cite |\n| --- | --- | --- | --- | --- | --- |\n| T1 | . | A | — | implement | — |\n\n## §B Bugs\n| id | invariant added | fix cite |\n| --- | --- | --- |\n| B1 | — | — |\n'
function fixture(root: string) {
  const files = new Map<string, string>([
    [`${root}/.scratchpad/INDEX.md`, '| wave | state |\n| --- | --- |\n| 2026-01-01-wave | live |\n'],
    [`${root}/.scratchpad/dossier/2026-01-01-wave/DOSSIER.md`, ledger],
  ])
  const calls: { argv: string[]; stdin: string }[] = []
  const env = new Map<string, string>()
  let run: Io['run'] = async (argv) => {
    if (argv.includes('session-start'))
      return { exitCode: 0, stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: 'session context' } }), stderr: '' }
    if (argv.includes('convergence-state')) return { exitCode: 0, stdout: 'prompt context', stderr: '' }
    if (argv.includes('fakeimpl')) return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: 'tests red' }), stderr: '' }
    return { exitCode: 0, stdout: '', stderr: '' }
  }
  const io: Io = {
    isDir: async (p) => p === `${root}/.scratchpad/dossier` || p === `${root}/.scratchpad/dossier/2026-01-01-wave`,
    read: async (p) => {
      const value = files.get(p)
      if (value === undefined) throw new Error('missing')
      return value
    },
    exists: async (p) => files.has(p),
    list: async () => ['2026-01-01-wave'],
    env: async (key) => env.get(key),
    run: async (argv, init) => {
      calls.push({ argv, stdin: init.stdin })
      return run(argv, init)
    },
  }
  return {
    io,
    files,
    calls,
    env,
    setRun: (fn: Io['run']) => {
      run = fn
    },
  }
}
async function harness(factory: ExtensionFactory | string, cwd: string) {
  const agentDir = await temp()
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager: SettingsManager.inMemory(),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    extensionFactories: typeof factory === 'string' ? [] : [factory],
    additionalExtensionPaths: typeof factory === 'string' ? [factory] : [],
  })
  await loader.reload()
  const loaded = loader.getExtensions()
  expect(loaded.errors).toEqual([])
  const models = await ModelRuntime.create({ authPath: join(agentDir, 'auth.json'), modelsPath: null, refreshOnCreate: false, allowModelNetwork: false })
  const runner = new ExtensionRunner(loaded.extensions, loaded.runtime, cwd, SessionManager.inMemory(cwd), new ModelRegistry(models))
  const messages: string[] = []
  let signal: AbortSignal | undefined
  runner.bindCore(
    {
      ...loaded.runtime,
      sendMessage: (msg) => {
        messages.push(String(msg.content))
      },
      getSessionName: () => undefined,
      setSessionName: () => {},
    },
    {
      getModel: () => undefined,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => signal,
      abort: () => {},
      hasPendingMessages: () => false,
      shutdown: () => {},
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => '',
    },
  )
  const errors: string[] = []
  runner.onError((e) => errors.push(e.error))
  const call = (toolName: string, input: Record<string, unknown>, id = 'call') =>
    runner.emitToolCall({ type: 'tool_call', toolName, input, toolCallId: id } as ToolCallEvent)
  const result = (toolName: string, input: Record<string, unknown>, id = 'call', details: unknown = {}) =>
    runner.emitToolResult({
      type: 'tool_result',
      toolName,
      input,
      toolCallId: id,
      content: [{ type: 'text', text: 'original' }],
      details,
      isError: false,
    } as ToolResultEvent)
  const boundary = () =>
    runner.emitBoundary({ type: 'agent_before_settle', outcome: 'completed' }, () => ({
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
      pendingMessages: [],
      canContinue: true,
    }))
  return {
    runner,
    messages,
    errors,
    call,
    result,
    boundary,
    setSignal: (s: AbortSignal) => {
      signal = s
    },
  }
}

describe('native dossier Pi runtime', () => {
  it('recognizes generated dossier skill names and native bare verdict agent names', async () => {
    expect(skillName('dossier-close')).toBe('dossier:close')
    expect(skillFromPath('/build/plugins/dossier/skills/dossier-close/SKILL.md')).toBe('dossier:close')
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    await h.result('dossier_delegate', {}, 'd', { agent: 'dossier-reviewer', id: 'one', text: 'REVIEW: PASS' })
    expect(f.calls.filter((c) => c.argv.includes('verdict-log'))).toHaveLength(1)
  })
  it('does not carry a late skill callback into the replacement session', async () => {
    const root = await temp()
    const f = fixture(root)
    const original = f.io.read
    let release: (() => void) | undefined
    let started: (() => void) | undefined
    const reached = new Promise<void>((r) => {
      started = r
    })
    f.io.read = async (path) => {
      if (path.endsWith('INDEX.md')) {
        f.io.read = original
        started?.()
        await new Promise<void>((r) => {
          release = r
        })
      }
      return original(path)
    }
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    const old = h.call('read', { path: '/skills/grilling/SKILL.md' }, 'old')
    await reached
    await h.runner.emit({ type: 'session_start', reason: 'new' })
    release?.()
    expect(await old).toMatchObject({ block: true })
    await h.call('read', { path: '/skills/grilling/SKILL.md' }, 'fresh')
    expect(JSON.stringify(await h.result('read', { path: '/skills/grilling/SKILL.md' }, 'fresh'))).toContain('dossier:grill')
  })
  it('normalizes all replacements without changing the native input, expands paths', () => {
    const input = {
      path: '@src/a.ts',
      oldText: 'a',
      newText: 'one',
      edits: [
        { oldText: 'b', newText: 'two' },
        { oldText: 'c', newText: '' },
      ],
    }
    expect(normalizeMutation('edit', input, '/repo')).toEqual({ filePath: '/repo/src/a.ts', chunks: ['two', '', 'one'] })
    expect(input.edits).toHaveLength(2)
    expect(normalizeMutation('write', { path: '~/x', content: 'x' }, '/repo')?.filePath).toBe(join(homedir(), 'x'))
    expect(normalizeMutation('read', input, '/repo')).toBeUndefined()
    for (const path of ['file:///repo/DOSSIER.md', 'file:///repo/DOSSIER%2Emd', '@file:///repo/DOSSIER%2Emd'])
      expect(normalizeMutation('write', { path, content: 'x' }, '/repo')?.filePath).toBe('/repo/DOSSIER.md')
  })
  it('loads the production default export with public loader and works without UI', async () => {
    const cwd = await temp()
    const h = await harness(fileURLToPath(new URL('../pi/index.ts', import.meta.url)), cwd)
    await h.runner.emit({ type: 'session_start', reason: 'startup' })
    await h.runner.getCommand('dossier-tasks')?.handler('', h.runner.createCommandContext())
    expect(h.messages.join('\n')).toContain('No live dossier')
    expect(h.errors).toEqual([])
  })
  it('blocks marker/header across every chunk, passes ordinary comments and scoped opt-outs', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    expect(await h.call('edit', { path: 'a.ts', edits: [{ newText: '// Step 1: dump the database' }, { newText: '// §V26 why' }] })).toMatchObject({
      block: true,
    })
    expect(await h.call('write', { path: 'a.ts', content: '// Step 1: dump the database' })).toBeUndefined()
    expect(await h.call('write', { path: 'DOSSIER.md', content: '`2026-01-01` · `active`' })).toMatchObject({ block: true })
    expect(await h.call('write', { path: '.scratchpad/notes.ts', content: '// §V26' })).toBeUndefined()
    f.env.set('DOSSIER_MARKER_GUARD', 'off')
    expect(await h.call('write', { path: 'DOSSIER.md', content: '`2026-01-01` · `active`' })).toBeUndefined()
    f.files.set(`${root}/.scratchpad/dossier/.invariant-guards.json`, '[]')
    f.setRun(async () => ({ exitCode: 1, stdout: 'invariant denied', stderr: '' }))
    expect(await h.call('edit', { path: 'a.ts', newText: 'bad' })).toMatchObject({ block: true, reason: 'invariant denied' })
    f.env.set('DOSSIER_INVARIANT_GUARD', 'off')
    expect(await h.call('edit', { path: 'a.ts', newText: 'bad' })).toBeUndefined()
  })
  it('composes cache advisories for all chunks and keeps parallel call results independent', async () => {
    const root = await temp()
    const f = fixture(root)
    f.setRun(async (_argv, init) => {
      const data = JSON.parse(init.stdin) as { content: string }
      return { exitCode: 0, stdout: JSON.stringify([{ key: data.content, line: `advice ${data.content}` }]), stderr: '' }
    })
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    await Promise.all([
      h.call('edit', { path: 'a.ts', edits: [{ newText: 'one' }, { newText: 'two' }] }, 'a'),
      h.call('write', { path: 'b.ts', content: 'three' }, 'b'),
    ])
    const [a, b] = await Promise.all([h.result('edit', { path: 'a.ts' }, 'a'), h.result('write', { path: 'b.ts' }, 'b')])
    expect(JSON.stringify(a?.content)).toContain('original')
    expect(JSON.stringify(a?.content)).toContain('advice one')
    expect(JSON.stringify(a?.content)).toContain('advice two')
    expect(JSON.stringify(a?.content)).not.toContain('advice three')
    expect(JSON.stringify(b?.content)).toContain('advice three')
    expect(h.errors).toEqual([])
  })
  it('bug reminders reach model results, deduplicate and reset at session start', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    const path = '.scratchpad/dossier/2026-01-01-wave/DOSSIER.md'
    expect(JSON.stringify(await h.result('write', { path }))).toContain('B1 has no invariant')
    expect(await h.result('write', { path })).toBeUndefined()
    await h.runner.emit({ type: 'session_start', reason: 'new' })
    expect(h.messages.join('\n')).toContain('session context')
    expect(JSON.stringify(await h.result('write', { path }))).toContain('B1 has no invariant')
    const start = await h.runner.emitBeforeAgentStart({ messageType: 'user', prompt: 'hello' }, { cwd: root })
    expect(JSON.stringify(start.messages)).toContain('prompt context')
  })
  it('grilling skill invocation and SKILL.md loads reach the model once per session', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    await h.call('read', { path: '/skills/grilling/SKILL.md' }, 'read')
    expect(JSON.stringify(await h.result('read', { path: '/skills/grilling/SKILL.md' }, 'read'))).toContain('dossier:grill')
    expect(await h.result('read', { path: '/skills/other/SKILL.md' }, 'other')).toBeUndefined()
    await h.runner.emit({ type: 'session_start', reason: 'new' })
    const start = await h.runner.emitBeforeAgentStart(
      { messageType: 'user', prompt: '<skill name="grilling" location="/skills/grilling/SKILL.md">\nbody\n</skill>' },
      { cwd: root },
    )
    expect(JSON.stringify(start.messages)).toContain('dossier:grill')
  })
  it('stop continues once, preserves earlier entries, resets only after settlement and skips cancellation', async () => {
    const root = await temp()
    const f = fixture(root)
    f.env.set('DOSSIER_FAKEIMPL_CMD', 'false')
    const prior: SessionBoundaryDraft = { type: 'custom_message', customType: 'prior', content: 'prior', display: false }
    const h = await harness((pi) => {
      pi.on('agent_before_settle', (e) => ({ entries: [...e.entries, prior] }))
      registerRuntime(pi, () => f.io)
    }, root)
    const first = await h.boundary()
    expect(first.continue).toBe(true)
    expect(first.entries[0]).toEqual(prior)
    expect(JSON.stringify(first.entries)).toContain('whole reply again')
    expect((await h.boundary()).entries).toEqual([prior])
    await h.runner.emit({ type: 'agent_settled', aborted: false })
    expect((await h.boundary()).continue).toBe(true)
    await h.runner.emit({ type: 'agent_settled', aborted: true })
    const controller = new AbortController()
    controller.abort()
    h.setSignal(controller.signal)
    expect((await h.boundary()).continue).toBe(false)
  })
  it('logs only successful generic delegate verdict details via ds, not ordinary tool text', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    await h.result('dossier_delegate', {}, 'd', { agent: 'dossier:dossier-reviewer', id: 'review-1', text: 'REVIEW: PASS' })
    await h.result('whetstone_delegate', {}, 'w', { agent: 'whetstone:whetstone-doubter', id: 'doubt-1', text: 'NO FAILURE FOUND' })
    await h.result('read', {}, 'r', { agent: 'dossier:dossier-reviewer', id: 'not-a-delegate', text: 'REVIEW: PASS' })
    const logs = f.calls.filter((c) => c.argv.includes('verdict-log'))
    expect(logs).toHaveLength(2)
    expect(JSON.parse(logs[0]!.stdin)).toEqual({ agent_type: 'dossier:dossier-reviewer', agent_id: 'review-1', last_assistant_message: 'REVIEW: PASS' })
  })
  it('is silent outside dossier projects and fails open only for inconclusive invariant checks', async () => {
    const root = await temp()
    const f = fixture(root)
    f.io.isDir = async () => false
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    expect(await h.call('write', { path: 'a.ts', content: '// §V26' })).toBeUndefined()
    f.io.isDir = async () => true
    f.files.set(`${root}/.scratchpad/dossier/.invariant-guards.json`, '[]')
    for (const [exitCode, stdout] of [
      [69, 'no node'],
      [70, 'internal error'],
      [1, ''],
      [0, ''],
    ] as const) {
      f.setRun(async () => ({ exitCode, stdout, stderr: '' }))
      expect(await h.call('edit', { path: 'a.ts', newText: 'ordinary' })).toBeUndefined()
    }
    f.setRun(async () => {
      throw new Error('spawn failed')
    })
    expect(await h.call('edit', { path: 'a.ts', newText: 'ordinary' })).toBeUndefined()
    expect(h.errors).toEqual([])
  })
  it('composes invariant advisories with prior native tool result patches', async () => {
    const root = await temp()
    const f = fixture(root)
    f.files.set(`${root}/.scratchpad/dossier/.invariant-guards.json`, '[]')
    f.setRun(async (argv) => ({ exitCode: 0, stdout: argv.includes('invariant-check') ? 'skipped pattern advisory' : '', stderr: '' }))
    const h = await harness((pi) => {
      pi.on('tool_result', (e) => ({ content: [...e.content, { type: 'text', text: 'earlier extension' }], details: { preserved: true } }))
      registerRuntime(pi, () => f.io)
    }, root)
    await h.call('edit', { path: 'a.ts', newText: 'ordinary' })
    const result = await h.result('edit', { path: 'a.ts' })
    expect(result?.details).toEqual({ preserved: true })
    expect(JSON.stringify(result?.content)).toContain('earlier extension')
    expect(JSON.stringify(result?.content)).toContain('skipped pattern advisory')
  })
  it('native UI status and tasks use read-only built-in UI methods', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    const statuses: (string | undefined)[] = []
    const widgets: unknown[] = []
    const options: string[][] = []
    h.runner.setUIContext(
      {
        ...h.runner.getUIContext(),
        setStatus: (_key, value) => {
          statuses.push(value)
        },
        setWidget: (_key, value) => {
          widgets.push(value)
        },
        select: async (_title, items) => {
          options.push(items)
          return undefined
        },
      },
      'rpc',
    )
    await h.runner.getCommand('dossier-tasks')?.handler('', h.runner.createCommandContext())
    expect(statuses.some((s) => s?.includes('/dossier-tasks'))).toBe(true)
    expect(widgets).toHaveLength(1)
    expect(options.flat().join('\n')).toContain('T1')
    expect(h.messages).toEqual([])
    expect(f.calls).toEqual([])
    expect(f.files.get(`${root}/.scratchpad/dossier/2026-01-01-wave/DOSSIER.md`)).toBe(ledger)
  })
  it('does not continue a stop without a block or on an aborted boundary', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    expect((await h.boundary()).continue).toBe(false)
    expect(f.calls.some((c) => c.argv.includes('fakeimpl'))).toBe(false)
    await h.runner.emit({ type: 'agent_settled', aborted: false })
    f.env.set('DOSSIER_FAKEIMPL_CMD', 'false')
    const aborted = await h.runner.emitBoundary({ type: 'agent_before_settle', outcome: 'aborted' }, () => ({
      contextEntries: [],
      contextMessages: [],
      llmMessages: [],
      pendingMessages: [],
      canContinue: false,
    }))
    expect(aborted.continue).toBe(false)
    expect(f.calls.some((c) => c.argv.includes('fakeimpl'))).toBe(false)
  })
  it('cancellation during a fail-open shared process result still blocks the mutation', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    f.files.set(`${root}/.scratchpad/dossier/.invariant-guards.json`, '[]')
    const controller = new AbortController()
    h.setSignal(controller.signal)
    f.setRun(async () => {
      controller.abort()
      return { exitCode: 70, stdout: '', stderr: '' }
    })
    expect(await h.call('edit', { path: 'a.ts', newText: 'ordinary' })).toMatchObject({ block: true, reason: 'dossier: tool call cancelled' })
  })
  it('cancelled mutations never pass even when a shared gate fails open', async () => {
    const root = await temp()
    const f = fixture(root)
    const h = await harness((pi) => registerRuntime(pi, () => f.io), root)
    const controller = new AbortController()
    controller.abort()
    h.setSignal(controller.signal)
    expect(await h.call('write', { path: 'a.ts', content: '// §V26' })).toMatchObject({ block: true })
  })
})

describe('native process boundary', () => {
  it('does not alter native replacement arguments or lose edits during concurrent execution', async () => {
    const cwd = await temp()
    const h = await harness(register, cwd)
    await writeFile(join(cwd, 'a.txt'), 'one\ntwo\nthree\n')
    const input = {
      path: '@a.txt',
      edits: [
        { oldText: 'one', newText: 'first' },
        { oldText: 'three', newText: 'last' },
      ],
    }
    const before = structuredClone(input)
    expect(await h.call('edit', input, 'e')).toBeUndefined()
    expect(input).toEqual(before)
    const writer = { path: 'b.txt', content: 'independent' }
    expect(await h.call('write', writer, 'w')).toBeUndefined()
    await Promise.all([createEditTool(cwd).execute('e', input), createWriteTool(cwd).execute('w', writer)])
    expect(await readFile(join(cwd, 'a.txt'), 'utf8')).toBe('first\ntwo\nlast\n')
    expect(await readFile(join(cwd, 'b.txt'), 'utf8')).toBe('independent')
  })
  it('cancelled native filesystem reads fail and output limits terminate child processes', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(nativeIo(controller.signal).read('/unused')).rejects.toThrow('cancelled')
    await expect(
      runBounded([process.execPath, '-e', 'process.stdout.write("x".repeat(2*1024*1024));setInterval(()=>{},1000)'], { stdin: '', timeoutMs: 2000 }),
    ).rejects.toThrow('output limit')
  })
  it('passes stdin, reports exit status, resolves plugin root file-relatively', async () => {
    const done = await runBounded([process.execPath, '-e', 'process.stdin.on("data", d => process.stdout.write(d)); process.exitCode=1'], {
      stdin: 'payload',
      timeoutMs: 2000,
    })
    expect(done).toMatchObject({ stdout: 'payload', exitCode: 1 })
    expect(nativeIo().cli).toMatch(/\/plugins\/dossier\/cli\/ds$/)
  })
  it('bounds timeouts and cancellation and kills descendants, without deferred writes', async () => {
    const dir = await temp()
    const target = join(dir, 'leaked')
    const script = `require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(`setTimeout(()=>require('node:fs').writeFileSync(${JSON.stringify(target)},'leak'),500)`)}],{stdio:'ignore'}); setInterval(()=>{},1000)`
    const controller = new AbortController()
    const pending = runBounded([process.execPath, '-e', script], { stdin: '', timeoutMs: 2000 }, controller.signal)
    setTimeout(() => controller.abort(), 100)
    await expect(pending).rejects.toThrow()
    await expect(runBounded([process.execPath, '-e', 'setInterval(()=>{},1000)'], { stdin: '', timeoutMs: 50 })).rejects.toThrow()
    await new Promise((r) => setTimeout(r, 650))
    await expect(readFile(target)).rejects.toThrow()
  })
  it('reads the real ledger for native status/tasks without creating a shadow ledger', async () => {
    const cwd = await temp()
    const path = join(cwd, '.scratchpad/dossier/2026-01-01-wave')
    await mkdir(path, { recursive: true })
    await writeFile(join(path, 'DOSSIER.md'), ledger)
    const h = await harness(register, cwd)
    await h.runner.getCommand('dossier-tasks')?.handler('', h.runner.createCommandContext())
    expect(h.messages.join('\n')).toContain('T1')
    expect(h.messages.join('\n')).toContain('implement')
    expect(await readFile(join(path, 'DOSSIER.md'), 'utf8')).toBe(ledger)
  })
})
