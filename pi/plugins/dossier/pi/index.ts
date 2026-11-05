import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent'
import { bugGate, ledgerRoot, promptGate, sessionGate, skillGate, stopGate, verdictGate, verifyGate, type Io } from '../hooks/gates.ts'
import { nativeIo } from './io.ts'
import { nativePath, normalizeMutation, skillFromPath, skillName } from './normalize.ts'
import { showStatus, taskView } from './ui.ts'
import { pluginRoot } from './io.ts'
import { registerAuto } from './auto.ts'
import { checkMutation } from './guards.ts'
import { registerDelegation } from '../../../hosts/pi/delegate.ts'

const RESEND = 'Then send the whole reply again. In focus mode the operator sees only your last message.'
type IoFactory = (signal?: AbortSignal) => Io

export default function register(pi: ExtensionAPI): void {
  registerRuntime(pi)
  registerAuto(pi)
  registerDelegation(pi, { plugin: 'dossier', root: pluginRoot })
}

export function registerRuntime(pi: ExtensionAPI, makeIo: IoFactory = nativeIo): void {
  let lifetime = new AbortController()
  let stopped = false
  let generation = 0
  let skills = new Set<string>()
  let verified = new Set<string>()
  let bugs = new Set<string>()
  const pending = new Map<string, string[]>()
  const signalOf = (ctx: ExtensionContext) => (ctx.signal ? AbortSignal.any([lifetime.signal, ctx.signal]) : lifetime.signal)
  const reset = () => {
    lifetime.abort()
    lifetime = new AbortController()
    generation++
    stopped = false
    skills = new Set()
    verified = new Set()
    bugs = new Set()
    pending.clear()
  }
  const refresh = async (ctx: ExtensionContext) => {
    const current = generation
    const io = makeIo(signalOf(ctx))
    const root = await ledgerRoot(io, ctx.cwd)
    const lines = await taskView(io, root, ctx.cwd)
    if (current === generation) showStatus(ctx, lines)
    return lines
  }

  pi.on('session_start', async (event, ctx) => {
    reset()
    const current = generation
    const io = makeIo(signalOf(ctx))
    const root = await ledgerRoot(io, ctx.cwd)
    const verdict = await sessionGate(io, root, {
      source: event.reason === 'new' ? 'clear' : event.reason === 'reload' ? 'startup' : event.reason,
      session_title: ctx.sessionManager.getSessionName() ?? '',
    })
    if (current !== generation) return
    if (verdict.context) {
      const away =
        root === ctx.cwd ? '' : `\ndossier ledger: ${root}/.scratchpad — this session works in ${ctx.cwd}; read and write the ledger by that absolute path.`
      pi.sendMessage({ customType: 'dossier-session', content: verdict.context + away, display: false })
    }
    if (verdict.title && !ctx.sessionManager.getSessionName()) pi.setSessionName(verdict.title)
    if (verdict.toast && ctx.hasUI) ctx.ui.notify(verdict.toast, 'info')
    await refresh(ctx)
  })
  pi.on('session_shutdown', (_event, ctx) => {
    reset()
    lifetime.abort()
    if (ctx.hasUI) {
      ctx.ui.setStatus('dossier', undefined)
      ctx.ui.setWidget('dossier', undefined)
    }
  })
  pi.on('session_tree', async (_event, ctx) => {
    reset()
    await refresh(ctx)
  })
  pi.on('before_agent_start', async (event, ctx) => {
    const seenSkills = skills
    const signal = signalOf(ctx)
    const io = makeIo(signal)
    const root = await ledgerRoot(io, ctx.cwd)
    const context: string[] = []
    const prompt = await promptGate(io, root, ctx.cwd)
    if (prompt) context.push(prompt)
    if (event.messageType === 'user') {
      const match = /^<skill name="([^"]+)" location="([^"]+)">/.exec(event.prompt)
      if (match) {
        const reminder = await skillGate(io, root, skillName(match[1] ?? '', match[2] ?? ''), seenSkills)
        if (reminder) context.push(reminder)
      }
    }
    if (context.length && !signal.aborted) return { message: { customType: 'dossier-prompt', content: context.join('\n\n'), display: false } }
  })

  pi.on('tool_call', async (event, ctx) => {
    const seenSkills = skills
    const seenVerified = verified
    const mutation = normalizeMutation(event.toolName, event.input, ctx.cwd)
    const skill = event.toolName === 'read' && typeof event.input.path === 'string' ? skillFromPath(nativePath(event.input.path, ctx.cwd)) : undefined
    if (!mutation && !skill) return
    const signal = signalOf(ctx)
    if (signal.aborted) return { block: true, reason: 'dossier: tool call cancelled' }
    const io = makeIo(signal)
    const root = await ledgerRoot(io, ctx.cwd)
    const context: string[] = []
    if (mutation) {
      const verdict = await checkMutation(io, root, mutation, event.toolName)
      if (verdict.deny) return { block: true, reason: verdict.deny }
      if (verdict.context) context.push(verdict.context)
      for (const chunk of mutation.chunks) {
        const input = { tool: event.toolName === 'write' ? 'Write' : 'Edit', file_path: mutation.filePath, content: chunk, new_string: chunk }
        const advice = await verifyGate(io, root, input, seenVerified)
        if (advice) context.push(advice)
      }
    }
    if (skill) {
      const reminder = await skillGate(io, root, skill, seenSkills)
      if (reminder) context.push(reminder)
    }
    if (signal.aborted) return { block: true, reason: 'dossier: tool call cancelled' }
    if (context.length) pending.set(event.toolCallId, context)
  })

  pi.on('tool_result', async (event, ctx) => {
    const context = pending.get(event.toolCallId) ?? []
    pending.delete(event.toolCallId)
    const signal = signalOf(ctx)
    if (signal.aborted) return
    const io = makeIo(signal)
    if (!event.isError && (event.toolName === 'write' || event.toolName === 'edit') && typeof event.input.path === 'string') {
      const advice = await bugGate(io, nativePath(event.input.path, ctx.cwd), bugs)
      if (advice) context.push(advice)
    }
    if (!event.isError && (event.toolName === 'dossier_delegate' || event.toolName === 'whetstone_delegate')) {
      const details: unknown = event.details
      if (
        details &&
        typeof details === 'object' &&
        'agent' in details &&
        'id' in details &&
        'text' in details &&
        typeof details.agent === 'string' &&
        typeof details.id === 'string' &&
        typeof details.text === 'string'
      ) {
        const agent =
          details.agent === 'dossier-reviewer'
            ? 'dossier:dossier-reviewer'
            : details.agent === 'whetstone-doubter'
              ? 'whetstone:whetstone-doubter'
              : details.agent
        await verdictGate(io, ctx.cwd, { agent_type: agent, agent_id: details.id, last_assistant_message: details.text })
      }
    }
    if (context.length && !signal.aborted)
      return {
        content: [...event.content, { type: 'text', text: context.join('\n\n') }],
        ...(event.structuredContent === undefined ? {} : { structuredContent: event.structuredContent }),
      }
  })
  pi.on('tool_execution_end', (event) => {
    pending.delete(event.toolCallId)
  })

  pi.on('agent_before_settle', async (event, ctx) => {
    const signal = signalOf(ctx)
    if (stopped || event.outcome !== 'completed' || signal.aborted) return
    stopped = true
    const io = makeIo(signal)
    const root = await ledgerRoot(io, ctx.cwd)
    const reason = await stopGate(io, root)
    if (!reason || signal.aborted) return
    return {
      entries: [...event.entries, { type: 'custom_message', customType: 'dossier-fakeimpl', content: `${reason}\n${RESEND}`, display: false }],
      continue: true,
    }
  })
  pi.on('agent_settled', async (_event, ctx) => {
    stopped = false
    pending.clear()
    await refresh(ctx)
  })
  pi.registerCommand('dossier-tasks', {
    description: 'Read the live dossier task ledger and dependency tree',
    handler: async (_args, ctx) => {
      const lines = await refresh(ctx)
      if (ctx.hasUI) await ctx.ui.select('Dossier tasks (read-only)', lines)
      else pi.sendMessage({ customType: 'dossier-tasks', content: lines.join('\n'), display: true })
    },
  })
}
