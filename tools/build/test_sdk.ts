import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { findPackageJSON } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionContext,
} from '@earendil-works/pi-coding-agent'
import { createDelegate, type DelegateContext } from '../../hosts/pi/delegate.ts'
import { buildArtifacts } from './build.ts'

type Provider = Parameters<ModelRuntime['registerNativeProvider']>[0]
type Stream = ReturnType<Provider['streamSimple']>
type Transcript = Parameters<Provider['streamSimple']>[1]
type Assistant = Awaited<ReturnType<Stream['result']>>
const aiPackage = findPackageJSON('@earendil-works/pi-ai', import.meta.resolve('@earendil-works/pi-coding-agent'))
if (!aiPackage) throw new Error('SDK public pi-ai dependency is missing')
const aiManifest: { exports: { '.': { import: string } } } = JSON.parse(await readFile(aiPackage, 'utf8'))
const { createAssistantMessageEventStream } = (await import(new URL(aiManifest.exports['.'].import, pathToFileURL(aiPackage)).href)) as {
  createAssistantMessageEventStream: () => Stream
}
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const temps: string[] = []
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})
async function temp() {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'pi-real-sdk-'))
  temps.push(dir)
  return dir
}
const model: NonNullable<ExtensionContext['model']> = {
  id: 'deterministic',
  name: 'Local deterministic fixture',
  provider: 'sdk-local-fixture',
  api: 'anthropic-messages',
  baseUrl: 'http://127.0.0.1:1/never-used',
  reasoning: false,
  input: ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
}
function answer(content: Assistant['content'], stopReason: Assistant['stopReason'] = 'stop'): Assistant {
  return {
    role: 'assistant',
    api: model.api,
    model: model.id,
    provider: model.provider,
    content,
    stopReason,
    timestamp: Date.now(),
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
  }
}
async function runtime(respond: (context: Transcript, options: Parameters<Provider['streamSimple']>[2]) => Assistant | Promise<Assistant>) {
  const requests: Transcript[] = []
  const authKeys: Array<string | undefined> = []
  const stream: Provider['streamSimple'] = (_model, context, options) => {
    requests.push(structuredClone(context))
    authKeys.push(options?.apiKey)
    const events = createAssistantMessageEventStream()
    void (async () => {
      try {
        const message = await respond(context, options)
        events.push({ type: 'start', partial: { ...message, content: [] } })
        events.push({ type: 'done', reason: message.stopReason as 'stop' | 'length' | 'toolUse', message })
        events.end(message)
      } catch (error) {
        const message = { ...answer([]), stopReason: 'error' as const, errorMessage: String(error) }
        events.push({ type: 'error', reason: 'error', error: message })
        events.end(message)
      }
    })()
    return events
  }
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => {
        throw new Error('Unexpected credential write')
      },
      delete: async () => {
        throw new Error('Unexpected credential deletion')
      },
    },
  })
  modelRuntime.registerNativeProvider({
    id: model.provider,
    name: 'Local fixture',
    auth: { apiKey: { name: 'In-memory fixture credential', resolve: async () => ({ auth: { apiKey: 'test-parent-auth' } }) } },
    getModels: () => [model],
    stream: (selected, context, options) => stream(selected, context, { apiKey: options?.apiKey, signal: options?.signal }),
    streamSimple: stream,
  })
  return { modelRuntime, requests, authKeys }
}
function loader(cwd: string, settingsManager: SettingsManager, extra: Partial<ConstructorParameters<typeof DefaultResourceLoader>[0]> = {}) {
  return new DefaultResourceLoader({
    cwd,
    agentDir: join(cwd, 'isolated-agent'),
    settingsManager,
    noContextFiles: true,
    noSkills: true,
    noExtensions: true,
    noPromptTemplates: true,
    noThemes: true,
    ...extra,
  })
}
const settings = () => SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } })

describe('real Pi SDK without a remote model', () => {
  it('runs the default production child factory with public parent auth, fresh history and actual read tools', async () => {
    const cwd = await temp()
    await writeFile(join(cwd, 'evidence.txt'), 'LOCAL-EVIDENCE-314')
    const local = await runtime((context) => {
      if (context.messages.some((message) => message.role === 'toolResult')) return answer([{ type: 'text', text: 'Observed LOCAL-EVIDENCE-314 via read.' }])
      if (JSON.stringify(context).includes('PARENT-CONVERSATION-SECRET')) return answer([{ type: 'text', text: 'Parent acknowledged.' }])
      return answer([{ type: 'toolCall', id: 'read-evidence', name: 'read', arguments: { path: 'evidence.txt' } }], 'toolUse')
    })
    let ctx: DelegateContext | undefined
    const config = settings()
    const resources = loader(cwd, config, {
      noSkills: true,
      extensionFactories: [
        (pi) => {
          pi.on('before_agent_start', (_event, context) => {
            ctx = context
          })
        },
      ],
    })
    await resources.reload()
    const { session: parent } = await createAgentSession({
      cwd,
      agentDir: join(cwd, 'isolated-agent'),
      model,
      modelRuntime: local.modelRuntime,
      settingsManager: config,
      resourceLoader: resources,
      sessionManager: SessionManager.inMemory(cwd),
      tools: [],
    })
    try {
      await parent.bindExtensions({})
      await parent.prompt('PARENT-CONVERSATION-SECRET')
      if (!ctx) throw new Error('Real extension context was not supplied')
      expect(await ctx.modelRegistry.getProviderAuth(model.provider)).toEqual({ auth: { apiKey: 'test-parent-auth' } })
      local.requests.length = 0
      local.authKeys.length = 0
      const mission = 'Read evidence.txt and report the observed token.'
      const run = createDelegate()
      const result = await run(ctx, { plugin: 'dossier', root: join(repo, 'plugins/dossier'), agent: 'dossier-reviewer', task: mission })
      expect(result.text).toBe('Observed LOCAL-EVIDENCE-314 via read.')
      expect(result.agent).toBe('dossier:dossier-reviewer')
      expect(result.id).not.toBe(parent.sessionId)
      expect(local.requests).toHaveLength(2)
      const first = local.requests[0]
      expect(first.messages.filter((message) => message.role !== 'system')).toEqual([
        expect.objectContaining({ role: 'user', content: [{ type: 'text', text: mission }] }),
      ])
      expect(JSON.stringify(local.requests)).not.toContain('PARENT-CONVERSATION-SECRET')
      expect(JSON.stringify(local.requests[1])).toContain('LOCAL-EVIDENCE-314')
      expect(
        first.messages
          .flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []))
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(['bash', 'find', 'grep', 'read'])
      expect(local.authKeys).toEqual(['test-parent-auth', 'test-parent-auth'])
      local.requests.length = 0
      const writable = await run(ctx, { plugin: 'dossier', root: join(repo, 'plugins/dossier'), agent: 'general-purpose', write: true, task: mission })
      expect(writable.id).not.toBe(result.id)
      expect(
        local.requests[0].messages
          .flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : []))
          .map((tool) => tool.name)
          .sort(),
      ).toEqual(['bash', 'edit', 'find', 'grep', 'read', 'write'])
      expect(local.requests[0].messages.filter((message) => message.role !== 'system')).toHaveLength(1)
      expect(parent.messages.filter((message) => message.role === 'user')).toHaveLength(1)
    } finally {
      parent.dispose()
    }
  })

  it.each(['absolute', 'encoded URL'] as const)('writable delegated builders retain mutation guards without parent history (%s)', async (pathKind) => {
    const cwd = await temp()
    await mkdir(join(cwd, '.scratchpad/dossier'), { recursive: true })
    const target = join(cwd, 'DOSSIER.md')
    await writeFile(target, 'original\n')
    const local = await runtime((context) => {
      if (JSON.stringify(context).includes('PARENT-CONVERSATION-SECRET')) return answer([{ type: 'text', text: 'Parent ready.' }])
      if (context.messages.some((message) => message.role === 'toolResult')) return answer([{ type: 'text', text: 'Attempt returned a tool result.' }])
      return answer(
        [
          {
            type: 'toolCall',
            id: 'child-write',
            name: 'write',
            arguments: {
              path: pathKind === 'absolute' ? target : pathToFileURL(target).href.replace('DOSSIER.md', 'DOSSIER%2Emd'),
              content: '`2026-11-04` · `active`',
            },
          },
        ],
        'toolUse',
      )
    })
    let ctx: DelegateContext | undefined
    const config = settings()
    const resources = loader(cwd, config, {
      extensionFactories: [
        (pi) => {
          pi.on('before_agent_start', (_event, context) => {
            ctx = context
          })
        },
      ],
    })
    await resources.reload()
    const { session: parent } = await createAgentSession({
      cwd,
      agentDir: join(cwd, 'isolated-agent'),
      model,
      modelRuntime: local.modelRuntime,
      settingsManager: config,
      resourceLoader: resources,
      sessionManager: SessionManager.inMemory(cwd),
      tools: [],
    })
    try {
      await parent.bindExtensions({})
      await parent.prompt('PARENT-CONVERSATION-SECRET')
      if (!ctx) throw new Error('Missing parent context')
      local.requests.length = 0
      await createDelegate()(ctx, {
        plugin: 'dossier',
        root: join(repo, 'plugins/dossier'),
        agent: 'general-purpose',
        write: true,
        task: 'Attempt the supplied write and report the result.',
      })
      expect(await readFile(target, 'utf8')).toBe('original\n')
      expect(JSON.stringify(local.requests)).toContain('refusing to write non-canonical header')
      const names = local.requests[0].messages.flatMap((message) => (message.role === 'system' ? (message.toolsAdded ?? []) : [])).map((tool) => tool.name)
      expect(names).not.toContain('dossier_delegate')
      expect(JSON.stringify(local.requests)).not.toContain('PARENT-CONVERSATION-SECRET')
    } finally {
      parent.dispose()
    }
  })

  it.each(['absolute', 'encoded URL'] as const)('loads 23 generated skills, denies native write and continues once for a claim (%s)', async (pathKind) => {
    const cwd = await temp()
    const output = join(cwd, 'generated')
    buildArtifacts({ root: repo, output })
    const manifest: { pi: { extensions: string[]; skills: string[] } } = JSON.parse(await readFile(join(output, 'package.json'), 'utf8'))
    const config = settings()
    const resources = loader(cwd, config, {
      additionalExtensionPaths: manifest.pi.extensions.map((path) => resolve(output, path)),
      additionalSkillPaths: manifest.pi.skills.map((path) => resolve(output, path)),
    })
    await resources.reload()
    expect(resources.getExtensions().errors).toEqual([])
    expect(resources.getExtensions().extensions).toHaveLength(2)
    const skills = resources.getSkills().skills
    expect(skills).toHaveLength(23)
    expect(new Set(skills.map((skill) => skill.name)).size).toBe(23)
    await mkdir(join(cwd, '.scratchpad/dossier'), { recursive: true })
    const protectedFile = join(cwd, 'DOSSIER.md')
    await writeFile(protectedFile, 'original evidence\n')
    let calls = 0
    const local = await runtime(() => {
      calls++
      if (calls === 1)
        return answer(
          [
            {
              type: 'toolCall',
              id: 'guarded-write',
              name: 'write',
              arguments: {
                path: pathKind === 'absolute' ? protectedFile : pathToFileURL(protectedFile).href.replace('DOSSIER.md', 'DOSSIER%2Emd'),
                content: '`2026-01-01` · `active`',
              },
            },
          ],
          'toolUse',
        )
      if (calls === 2) return answer([{ type: 'text', text: 'The hook blocks unsafe edits.' }])
      if (calls === 3) return answer([{ type: 'text', text: 'Advisory only; no broader enforcement or successful work claimed.' }])
      throw new Error('Unexpected unbounded advisory continuation')
    })
    const { session } = await createAgentSession({
      cwd,
      agentDir: join(cwd, 'isolated-agent'),
      model,
      modelRuntime: local.modelRuntime,
      settingsManager: config,
      resourceLoader: resources,
      sessionManager: SessionManager.inMemory(cwd),
    })
    try {
      await session.bindExtensions({})
      expect(session.getActiveToolNames()).toEqual(
        expect.arrayContaining(['dossier_delegate', 'whetstone_delegate', 'dossier_auto', 'whetstone_verify_claims']),
      )
      await session.prompt('Attempt the supplied write and report what happened.')
      expect(await readFile(protectedFile, 'utf8')).toBe('original evidence\n')
      expect(local.requests[1].messages).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'toolResult', toolName: 'write', isError: true })]))
      expect(JSON.stringify(local.requests[1])).toContain("refusing to write non-canonical header state 'active'")
      expect(local.requests).toHaveLength(3)
      expect(JSON.stringify(local.requests[2])).toContain('Unbacked claim in the reply')
      expect(session.getLastAssistantText()).toBe('Advisory only; no broader enforcement or successful work claimed.')
    } finally {
      session.dispose()
    }
  })
})
