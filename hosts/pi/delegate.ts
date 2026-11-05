import { readFile, realpath, access } from 'node:fs/promises'
import { join, relative, isAbsolute, resolve } from 'node:path'
import {
  createAgentSession,
  createExtensionRuntime,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  truncateHead,
  type AgentSession,
  type CreateAgentSessionOptions,
  type ExtensionAPI,
  type ExtensionContext,
  type ResourceLoader,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export type DelegateOptions = {
  plugin: 'dossier' | 'whetstone'
  root: string
  agent: string
  task: string
  signal?: AbortSignal
  write?: boolean
  model?: string
}
export type DelegateResult = { text: string; agent: string; id: string }
export type DelegateContext = Pick<ExtensionContext, 'cwd' | 'model' | 'signal'> & {
  modelRegistry: Pick<ExtensionContext['modelRegistry'], 'find' | 'getProvider' | 'getProviderAuth'>
}
export type DelegateSession = Pick<AgentSession, 'model' | 'sessionId' | 'messages' | 'subscribe' | 'prompt' | 'abort' | 'dispose'>
export type DelegateFactory = (
  options: CreateAgentSessionOptions,
  ctx: DelegateContext,
  signal?: AbortSignal,
) => Promise<{ session: DelegateSession; modelFallbackMessage?: string }>

const agents = {
  dossier: ['dossier-scout', 'dossier-reviewer'],
  whetstone: ['whetstone-doubter', 'whetstone-scout', 'whetstone-grounder'],
} as const
const readTools = ['read', 'grep', 'find']
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000

async function resources(systemPrompt: string, options: DelegateOptions, cwd: string): Promise<ResourceLoader> {
  let extensions = { extensions: [], errors: [], runtime: createExtensionRuntime() } as ReturnType<ResourceLoader['getExtensions']>
  if (options.write === true) {
    const guard = resolve(options.root, options.plugin === 'dossier' ? 'pi/guards.ts' : '../dossier/pi/guards.ts')
    let available = true
    try {
      await access(guard)
    } catch (error) {
      if (options.plugin === 'whetstone' && (error as NodeJS.ErrnoException).code === 'ENOENT') available = false
      else throw new Error(`Writable delegation requires dossier mutation hooks: ${guard}`, { cause: error })
    }
    if (available) {
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: options.root,
        settingsManager: SettingsManager.inMemory(),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
        additionalExtensionPaths: [guard],
      })
      await loader.reload()
      extensions = loader.getExtensions()
      if (extensions.errors.length) throw new Error(`Cannot load child mutation hooks: ${extensions.errors.map((error) => error.error).join('; ')}`)
    }
  }
  return {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => {},
    reload: async () => {},
  }
}

async function agentBody(options: DelegateOptions): Promise<string> {
  if (options.agent === 'general-purpose') return 'You are a general-purpose builder. Complete only the supplied mission.'
  if (!/^[a-z][a-z0-9-]*$/.test(options.agent) || !agents[options.plugin]?.some((agent) => agent === options.agent)) {
    throw new Error(`Unknown agent for ${options.plugin}: ${options.agent}`)
  }
  const root = await realpath(options.root)
  const path = await realpath(join(root, 'agents', `${options.agent}.md`))
  const rel = relative(root, path)
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Agent prompt escapes plugin root')
  let body = (await readFile(path, 'utf8')).replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  if (body.startsWith('---\n')) {
    const lines = body.split('\n')
    const end = lines.findIndex((line, index) => index > 0 && /^---[ \t]*$/.test(line))
    if (end < 0) throw new Error('Unclosed agent frontmatter')
    body = lines
      .slice(end + 1)
      .join('\n')
      .trim()
  }
  if (!body.trim()) throw new Error('Empty agent prompt')
  return body.replaceAll('${CLAUDE_PLUGIN_ROOT}', root)
}

const productionFactory: DelegateFactory = async (options, ctx, signal) => {
  const model = options.model
  if (!model) throw new Error('Delegation requires a selected model')
  const provider = ctx.modelRegistry.getProvider(model.provider)
  const resolveAuth = async () => {
    signal?.throwIfAborted()
    const auth = await ctx.modelRegistry.getProviderAuth(model.provider)
    if (!auth)
      throw new Error(
        `Cannot inherit credentials for ${model.provider}: public Pi modelRegistry exposes no resolved auth. Private transient credentials are unsupported; no provider fallback was attempted.`,
      )
    return auth
  }
  if (!provider) throw new Error(`Cannot inherit provider ${model.provider} from public Pi modelRegistry; no provider fallback was attempted`)
  await resolveAuth()
  const modelRuntime = await ModelRuntime.create({
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false,
    signal,
    credentials: {
      read: async () => undefined,
      list: async () => [],
      modify: async () => {
        throw new Error('Delegation credential writes are disabled')
      },
      delete: async () => {
        throw new Error('Delegation credential writes are disabled')
      },
    },
  })
  modelRuntime.registerNativeProvider({
    ...provider,
    getModels: () => [model],
    getAllModels: () => [model],
    refreshModels: undefined,
    auth: { apiKey: { name: 'Parent Pi credentials', resolve: resolveAuth } },
  })
  signal?.throwIfAborted()
  return createAgentSession({ ...options, modelRuntime })
}

export function createDelegate(factory: DelegateFactory = productionFactory, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return async (ctx: DelegateContext, options: DelegateOptions): Promise<DelegateResult> => {
    const signals = [options.signal, ctx.signal].filter((s): s is AbortSignal => s !== undefined)
    const signal = signals.length ? AbortSignal.any(signals) : undefined
    signal?.throwIfAborted()
    if (!options.task.trim()) throw new Error('Delegation task must not be empty')
    if (options.write !== undefined && typeof options.write !== 'boolean') throw new Error('write must be an explicit boolean')
    if (options.write === true && options.agent !== 'general-purpose') throw new Error('write=true is allowed only for general-purpose')
    let model = ctx.model
    if (options.model !== undefined) {
      const slash = options.model.indexOf('/')
      if (slash < 1 || slash === options.model.length - 1) throw new Error('Explicit model must be provider/model; aliases are not resolved')
      model = ctx.modelRegistry.find(options.model.slice(0, slash), options.model.slice(slash + 1))
      if (!model) throw new Error(`Unknown model: ${options.model}`)
    }
    if (!model) throw new Error('Delegation requires a selected model; no fallback is allowed')

    let session: DelegateSession | undefined
    let unsubscribe: (() => void) | undefined
    let stopped = false
    let rejectStop!: (error: Error) => void
    const stop = new Promise<never>((_resolve, reject) => {
      rejectStop = reject
    })
    const controller = new AbortController()
    const cancel = (error: Error) => {
      if (stopped) return
      stopped = true
      controller.abort(error)
      if (session) void session.abort().catch(() => {})
      rejectStop(error)
    }
    const onAbort = () => cancel(new Error('Delegation aborted'))
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => cancel(new Error(`Delegation timed out after ${timeoutMs}ms`)), timeoutMs)
    try {
      const work = async (): Promise<DelegateResult> => {
        const body = await agentBody(options)
        controller.signal.throwIfAborted()
        const writable = options.agent === 'general-purpose' && options.write === true
        const tools = [...readTools]
        if (options.agent !== 'whetstone-doubter') tools.push('bash')
        if (writable) tools.push('edit', 'write')
        const systemPrompt = [
          body,
          "This is a fresh, independent artifact-only mission. No parent conversation or reasoning is available. Evaluate the artifacts yourself; do not infer the parent's preferred verdict.",
          `Available Pi tools: ${tools.join(', ')}. Claude tool names Read/Grep/Glob correspond to read/grep/find. WebFetch and WebSearch are not available in this runtime; report missing source access honestly.`,
          writable
            ? 'File changes are explicitly authorized for this mission only.'
            : 'Do not write or edit files. Bash, when available, is read-only by instruction only (prompt-only), NOT sandboxed: do not use redirection, mutation commands or other write side effects.',
          'Return a nonempty final answer with evidence; never report an unperformed check as a successful verdict.',
        ].join('\n\n')
        const created = await factory(
          {
            cwd: ctx.cwd,
            model,
            thinkingLevel: 'off',
            tools,
            resourceLoader: await resources(systemPrompt, options, ctx.cwd),
            sessionManager: SessionManager.inMemory(ctx.cwd),
            settingsManager: SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false } }),
          },
          ctx,
          controller.signal,
        )
        if (stopped) {
          created.session.dispose()
          throw new Error('Delegation aborted during session creation')
        }
        session = created.session
        if (created.modelFallbackMessage || !session.model || session.model.provider !== model.provider || session.model.id !== model.id) {
          throw new Error('Child model unavailable or changed; no model fallback is allowed')
        }
        let failure: string | undefined
        unsubscribe = session.subscribe((event) => {
          if (
            event.type === 'message_end' &&
            event.message.role === 'assistant' &&
            (event.message.stopReason === 'error' || event.message.stopReason === 'aborted')
          ) {
            failure = event.message.errorMessage || `Child ${event.message.stopReason}`
          }
        })
        await session.prompt(options.task, { expandPromptTemplates: false })
        controller.signal.throwIfAborted()
        if (failure) throw new Error(failure)
        const last = session.messages.at(-1)
        if (!last || last.role !== 'assistant') throw new Error('Child completed without an assistant answer')
        if (last.stopReason !== 'stop') throw new Error(last.errorMessage || `Child did not complete successfully: ${last.stopReason}`)
        const text = last.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
          .trim()
        if (!text) throw new Error('Child returned an empty answer; no verdict was produced')
        return { text, agent: `${options.plugin}:${options.agent}`, id: session.sessionId }
      }
      return await Promise.race([work(), stop])
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      unsubscribe?.()
      session?.dispose()
    }
  }
}

export function runDelegate(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  options: {
    plugin: 'dossier' | 'whetstone'
    root: string
    agent: string
    task: string
    signal?: AbortSignal
    write?: boolean
    model?: string
  },
): Promise<{ text: string; agent: string; id: string }> {
  void pi
  return createDelegate()(ctx, options)
}

export function registerDelegation(pi: ExtensionAPI, options: { plugin: 'dossier' | 'whetstone'; root: string }): void {
  pi.registerTool({
    name: `${options.plugin}_delegate`,
    label: `${options.plugin} delegate`,
    description: `Run an independent fresh-context artifact-only mission. Agents: ${agents[options.plugin].join(', ')}, general-purpose. Named agents cannot edit/write; Bash read-only is prompt-only, not sandboxed. Only general-purpose with explicit write=true may edit/write. Uses the current model or an exact provider/model. Output capped at 50KB/2000 lines; full text in details.`,
    parameters: Type.Object(
      {
        agent: Type.String({ minLength: 1 }),
        task: Type.String({ minLength: 1 }),
        write: Type.Optional(Type.Boolean()),
        model: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    async execute(_id, input, signal, _onUpdate, ctx) {
      const result = await runDelegate(pi, ctx, { ...options, ...input, signal })
      const output = truncateHead(result.text)
      return {
        content: [{ type: 'text', text: output.content + (output.truncated ? '\n[Output truncated; full text in tool details.]' : '') }],
        details: result,
      }
    },
  })
}
