import type { EngineInterface, Register } from 'claude-code'
import { BUILTINS, editGate, type Io, skillGate, skillOf } from './gates.ts'

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
    env: (name) => (name === 'DOSSIER_MARKER_GUARD' ? $.env.get('DOSSIER_MARKER_GUARD') : $.env.get('DOSSIER_INVARIANT_GUARD')),
    run: (argv, init) => $.process.run(argv, init),
    cli: `${$.plugin.root}/cli/ds`,
  }
}

const seen = new Set<string>()

export const register: Register = (on) => {
  on('classic.PreToolUse', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    let context: string | undefined
    if (input.tool === 'Skill') {
      context = await skillGate(ioOf($), await $.session.cwd(), skillOf(input), seen)
    } else if (input.tool === 'Edit' || input.tool === 'Write') {
      const verdict = await editGate(ioOf($), await $.session.cwd(), input)
      if (verdict.deny) return { deny: verdict.deny }
      context = verdict.context
    }
    const result = await next(e)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.UserPromptExpansion', async ($, e, next) => {
    const result = await next(e)
    if (!BUILTINS.has(e.command_name) || !e.cwd) return result
    const context = await skillGate(ioOf($), e.cwd, e.command_name, seen)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })
}
