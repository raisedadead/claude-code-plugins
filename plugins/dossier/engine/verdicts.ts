import { splitLines } from './text.ts'

const VERDICT_AGENTS = new Set(['whetstone:whetstone-doubter', 'dossier:dossier-reviewer'])
const GRAMMAR = /^(DOUBT: FAILURES|DOUBT: NO FAILURE FOUND|NO FAILURE FOUND|REVIEW: PASS|REVIEW: CHANGES|SUBTRACT: NOTHING TO CUT|SUBTRACT: [1-9]\d* CUTS?)$/

export function isVerdictAgent(type: unknown): boolean {
  return typeof type === 'string' && VERDICT_AGENTS.has(type)
}

export function verdictLines(text: string): string[] {
  const first = splitLines(text)
    .map((line) => line.replace(/[*`#>]/g, '').trim())
    .find((line) => GRAMMAR.test(line))
  return first ? [first] : []
}
