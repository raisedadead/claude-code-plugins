import type { Register } from 'claude-code'
import { flaggedUnits } from './claim-check.ts'

const MAX_SHOWN = 10
const MAX_REASON_CHARS = 2000

function claimReason(reply: string): string | undefined {
  const flagged = flaggedUnits(reply).map(([number, unit]) => `line ${number}: "${unit}"`)
  if (!flagged.length) return undefined
  const shown = flagged.slice(0, MAX_SHOWN)
  if (flagged.length > MAX_SHOWN) shown.push(`… and ${flagged.length - MAX_SHOWN} more`)
  const body = [...shown.join('\n')].slice(0, MAX_REASON_CHARS).join('')
  return (
    'Unbacked claim in the reply:\n' +
    `${body}\n` +
    'Name the exit code, cite the source, or label it advisory / model-judgment / opt-in — or drop the verb.'
  )
}

export const register: Register = (on) => {
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (e.stop_hook_active) return result
    const reason = claimReason(e.last_assistant_message ?? '')
    if (!reason) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), reason] }
  })
}
