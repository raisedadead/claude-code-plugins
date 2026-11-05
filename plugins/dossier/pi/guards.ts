import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import type { Edit } from '../engine/guards.ts'
import { editGate, ledgerRoot, type Io, type Verdict } from '../hooks/gates.ts'
import { nativeIo } from './io.ts'
import { normalizeMutation } from './normalize.ts'

export async function checkMutation(io: Io, root: string, mutation: Edit, tool: string): Promise<Verdict> {
  const context: string[] = []
  for (const chunk of mutation.chunks) {
    const verdict = await editGate(io, root, { tool: tool === 'write' ? 'Write' : 'Edit', file_path: mutation.filePath, content: chunk, new_string: chunk })
    if (verdict.deny) return verdict
    if (verdict.context) context.push(verdict.context)
  }
  return context.length ? { context: context.join('\n\n') } : {}
}

export default function registerMutationGuards(pi: ExtensionAPI): void {
  const pending = new Map<string, string>()
  pi.on('session_start', () => pending.clear())
  pi.on('tool_call', async (event, ctx) => {
    const mutation = normalizeMutation(event.toolName, event.input, ctx.cwd)
    if (!mutation) return
    if (ctx.signal?.aborted) return { block: true, reason: 'dossier: tool call cancelled' }
    const io = nativeIo(ctx.signal)
    const root = await ledgerRoot(io, ctx.cwd)
    const verdict = await checkMutation(io, root, mutation, event.toolName)
    if (ctx.signal?.aborted) return { block: true, reason: 'dossier: tool call cancelled' }
    if (verdict.deny) return { block: true, reason: verdict.deny }
    if (verdict.context) pending.set(event.toolCallId, verdict.context)
  })
  pi.on('tool_result', (event) => {
    const context = pending.get(event.toolCallId)
    pending.delete(event.toolCallId)
    if (context) return { content: [...event.content, { type: 'text', text: context }] }
  })
  pi.on('tool_execution_end', (event) => {
    pending.delete(event.toolCallId)
  })
}
