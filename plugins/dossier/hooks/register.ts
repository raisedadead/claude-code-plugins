import type { EngineInterface, Register } from 'claude-code'
import { BUILTINS, editGate, type Io, ledgerRoot, promptGate, sessionGate, skillGate, skillOf, stopGate, verifyGate } from './gates.ts'

function ioOf($: EngineInterface): Io {
  return {
    isDir: async (path) => {
      try {
        return (await $.fs.stat(path)).kind === 'dir'
      } catch {
        return false
      }
    },
    read: async (path) => String(await $.fs.read(path)),
    exists: (path) => $.fs.exists(path),
    list: async (path) => (await $.fs.list(path)).map((entry) => entry.name),
    env: (name) => {
      if (name === 'DOSSIER_MARKER_GUARD') return $.env.get('DOSSIER_MARKER_GUARD')
      if (name === 'DOSSIER_INVARIANT_GUARD') return $.env.get('DOSSIER_INVARIANT_GUARD')
      return $.env.get('DOSSIER_FAKEIMPL_CMD')
    },
    run: (argv, init) => $.process.run(argv, init),
    cli: `${$.plugin.root}/cli/ds`,
  }
}

const seen = new Set<string>()
const verified = new Set<string>()

export const register: Register = (on) => {
  on('classic.PreToolUse', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const context: string[] = []
    if (input.tool === 'Skill') {
      context.push((await skillGate(ioOf($), await ledgerRoot(ioOf($), await $.session.cwd()), skillOf(input), seen)) ?? '')
    } else if (input.tool === 'Edit' || input.tool === 'Write') {
      const root = await ledgerRoot(ioOf($), await $.session.cwd())
      const verdict = await editGate(ioOf($), root, input)
      if (verdict.deny) return { deny: verdict.deny }
      context.push(verdict.context ?? '', (await verifyGate(ioOf($), root, input, verified)) ?? '')
    }
    const result = await next(e)
    const added = context.filter(Boolean)
    if (!added.length) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), ...added] }
  })

  on('classic.UserPromptExpansion', async ($, e, next) => {
    const result = await next(e)
    if (!BUILTINS.has(e.command_name) || !e.cwd) return result
    const context = await skillGate(ioOf($), await ledgerRoot(ioOf($), e.cwd), e.command_name, seen)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const root = await ledgerRoot(ioOf($), e.cwd)
    const verdict = await sessionGate(ioOf($), root, { source: e.source, session_title: e.session_title ?? '' })
    if (verdict.toast) $.ui.toast(verdict.toast)
    const away = root === e.cwd ? [] : [`dossier ledger: ${root}/.scratchpad — this session works in ${e.cwd}; read and write the ledger by that absolute path.`]
    const context = [...(verdict.context ? [verdict.context] : []), ...(verdict.context ? away : [])]
    return {
      ...result,
      ...(context.length ? { additionalContext: [...(result.additionalContext ?? []), ...context] } : {}),
      ...(verdict.title && !result.sessionTitle ? { sessionTitle: verdict.title } : {}),
    }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const context = await promptGate(ioOf($), await ledgerRoot(ioOf($), e.cwd), e.cwd)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block) return result
    const block = await stopGate(ioOf($), e.cwd)
    return block ? { ...result, block } : result
  })
}
