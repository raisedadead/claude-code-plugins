import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { createClaimAdvisory } from './claims.ts'
import { MAX_CLAIMS, verifyClaims } from './verify.ts'
import { registerDelegation } from '../../../hosts/pi/delegate.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const boundedText = () => Type.String({ minLength: 1, maxLength: 2000 })

export default function register(pi: ExtensionAPI): void {
  registerDelegation(pi, { plugin: 'whetstone', root })
  const advisory = createClaimAdvisory()
  pi.on('session_start', () => advisory.reset())
  pi.on('agent_settled', () => advisory.reset())
  pi.on('agent_before_settle', (event, ctx) => {
    if (ctx.signal?.aborted) return
    return advisory.beforeSettle(event)
  })
  pi.registerTool({
    name: 'whetstone_verify_claims',
    label: 'Verify claims',
    description:
      'Gather sourced claims for a question or verify explicit claims with independent fresh grounders. Verdicts are model-judgment; missing or invalid rulings are UNRULED. At most 100 claims, 1–4 scouts, batches of 1–10, 120 seconds per delegate. Model-facing JSON is capped at 45000 UTF-8 bytes; full results remain in details.',
    promptSnippet: 'Gather and independently verify sourced claims (model-judgment)',
    parameters: Type.Object({
      question: Type.Optional(boundedText()),
      claims: Type.Optional(
        Type.Array(
          Type.Object({
            claim: boundedText(),
            source: boundedText(),
            date: Type.Optional(Type.String({ maxLength: 2000 })),
            primary: Type.Optional(Type.Boolean()),
          }),
          { maxItems: MAX_CLAIMS },
        ),
      ),
      scouts: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })),
      batch: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
    }),
    async execute(_id, params, signal, _onUpdate, ctx) {
      const details = await verifyClaims(
        params,
        async (agent, task, delegateSignal) => {
          const { runDelegate } = await import('../../../hosts/pi/delegate.ts')
          const result = await runDelegate(pi, ctx, { plugin: 'whetstone', root, agent, task, signal: delegateSignal, write: false })
          return result.text
        },
        signal,
      )
      const serialized = JSON.stringify(details)
      const text =
        Buffer.byteLength(serialized, 'utf8') <= 45000
          ? serialized
          : JSON.stringify({
              question: details.question,
              tally: details.tally,
              enforcement: details.enforcement,
              notice: 'Full claim rows exceed the 45000-byte display limit; see tool result details. This summary does not establish individual claims.',
            })
      return { content: [{ type: 'text', text }], details, isError: Boolean(details.error) }
    },
  })
}
