import type { EngineInterface, Register } from 'claude-code'

const TRIAGE_TIMEOUT_MS = 20_000
const STATUS_TIMEOUT_MS = 5_000
const QUIET = 'Nothing is hanging and no dossier is live.'

const oneLine = (stdout: string): string => stdout.split('\n').filter(Boolean).join(' │ ')

async function mark($: EngineInterface, cwd: string): Promise<void> {
  if (!(await $.session.surfaces()).length) return
  let line = ''
  try {
    const session = await $.session.id()
    if (!session) throw new Error('no session id')
    const done = await $.process.run(['sh', `${$.plugin.root}/cli/ds`, 'status', '--session', session], { cwd, timeoutMs: STATUS_TIMEOUT_MS })
    if (done.exitCode === 0) line = oneLine(done.stdout)
  } catch {
    line = ''
  }
  $.ui.status(line || undefined)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await mark($, e.cwd)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (!e.agentId) await mark($, await $.session.cwd())
    return next(e)
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (e.source === 'compact') return result
    if (e.source === 'clear') await mark($, e.cwd).catch(() => undefined)
    let done: { exitCode: number; stdout: string }
    try {
      done = await $.process.run(['sh', `${$.plugin.root}/cli/ds`, 'triage', '--start'], { cwd: e.cwd, timeoutMs: TRIAGE_TIMEOUT_MS })
    } catch {
      return result
    }
    const text = done.stdout.trim()
    if (done.exitCode !== 0 || !text || text === QUIET) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), `ds triage:\n${text}`] }
  })
}
