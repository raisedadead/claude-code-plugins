import type { Register } from 'claude-code'

const TRIAGE_TIMEOUT_MS = 20_000
const QUIET = 'Nothing is hanging and no dossier is live.'

export const register: Register = (on) => {
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'compact') return result
    let done: { exitCode: number; stdout: string }
    try {
      done = await $.process.run(['sh', `${$.plugin.root}/cli/ds`, 'triage'], { cwd: e.cwd, timeoutMs: TRIAGE_TIMEOUT_MS })
    } catch {
      return result
    }
    const text = done.stdout.trim()
    if (done.exitCode !== 0 || !text || text === QUIET) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), `ds triage:\n${text}`] }
  })
}
