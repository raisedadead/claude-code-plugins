import type { AgentBeforeSettleEvent, AgentBeforeSettleEventResult } from '@earendil-works/pi-coding-agent'
import { flaggedUnits } from '../hooks/claim-check.ts'

export function claimReason(reply: string): string | undefined {
  const flagged = flaggedUnits(reply).map(([number, unit]) => `line ${number}: "${unit}"`)
  if (!flagged.length) return undefined
  const shown = flagged.slice(0, 10)
  if (flagged.length > 10) shown.push(`… and ${flagged.length - 10} more`)
  const body = [...shown.join('\n')].slice(0, 2000).join('')
  return (
    'Unbacked claim in the reply:\n' +
    `${body}\n` +
    'Name the exit code, cite the source, or label it advisory / model-judgment / opt-in — or drop the blocks / enforces / gates / denies / prevents / refuses verb.\n' +
    'Then send the whole reply again with the fix. In focus mode the operator sees only your last message.'
  )
}

export function createClaimAdvisory() {
  let sent = false
  return {
    reset() {
      sent = false
    },
    beforeSettle(event: AgentBeforeSettleEvent): AgentBeforeSettleEventResult | undefined {
      if (sent || event.outcome !== 'completed') return
      const last = event.context.contextMessages.findLast((message) => message.role === 'assistant')
      if (!last || last.role !== 'assistant' || last.stopReason === 'aborted' || last.stopReason === 'error') return
      const text = last.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const reason = claimReason(text)
      if (!reason) return
      sent = true
      return {
        entries: [...event.entries, { type: 'custom_message', customType: 'whetstone-claim-advisory', content: reason, display: false }],
        continue: true,
      }
    },
  }
}
