import { headerIndex, lines, sAppend, unlines } from './ledger.ts'

type Step = { readonly id: string; readonly apply: (text: string) => { text: string; kept: string } | undefined }

const THIRD = /^(`[^`]*` · `[^`]*`) · (.*)$/
const PHASE = /^`P\d+\/\d+`\s*$/

const STEPS: readonly Step[] = [
  {
    id: 'header-two-field',
    apply: (text) => {
      const rows = lines(text)
      const at = headerIndex(rows)
      const match = THIRD.exec(rows[at] ?? '')
      if (!match) return undefined
      rows[at] = match[1] ?? ''
      const rest = (match[2] ?? '').trim().replaceAll(';', ',')
      return { text: unlines(rows), kept: PHASE.test(rest) ? '' : rest }
    },
  },
]

export function migrate(text: string, stamp: string): { text: string; applied: string[] } {
  let next = text
  const applied: string[] = []
  for (const step of STEPS) {
    const result = step.apply(next)
    if (!result) continue
    applied.push(step.id)
    next = sAppend(result.text, `${stamp} ds:migrate — ${step.id}${result.kept ? ` kept: ${result.kept}` : ''}`)
  }
  return { text: next, applied }
}
