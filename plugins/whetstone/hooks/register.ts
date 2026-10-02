import type { Register } from 'claude-code'
import { flaggedVerdict, scanText } from './claim-check.ts'

const MAX_SHOWN = 10
const MAX_REASON_CHARS = 2000

function claimReason(reply: string): string | undefined {
  const flagged = scanText(reply, '<stdin>')
  if (!flagged.length) return undefined
  const lines = [...flagged, flaggedVerdict(flagged.length)]
  const shown = lines.slice(0, MAX_SHOWN)
  if (lines.length > MAX_SHOWN) shown.push(`… and ${lines.length - MAX_SHOWN} more`)
  const body = [...shown.join('\n')].slice(0, MAX_REASON_CHARS).join('')
  return (
    'Unbacked enforcement claim in the reply:\n' +
    `${body}\n` +
    'A sentence saying something blocks, enforces, gates, denies, prevents ' +
    'or refuses is a claim about runtime. Name the exit code, cite the ' +
    'source, or label it advisory / model-judgment / opt-in — or drop the ' +
    'verb. This gate fires once per turn.'
  )
}

export const register: Register = (on) => {
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.stop_hook_active) return result
    const reason = claimReason(e.last_assistant_message ?? '')
    if (!reason) return result
    return { ...result, block: result.block ? `${result.block}\n\n${reason}` : reason }
  })
}
