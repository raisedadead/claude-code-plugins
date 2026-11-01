import { splitLines } from './text.ts'

const VERDICT_AGENTS = new Set(['whetstone-doubter', 'dossier-reviewer'])
const GRAMMAR = /^(DOUBT: FAILURES|DOUBT: NO FAILURE FOUND|NO FAILURE FOUND|REVIEW: PASS|REVIEW: CHANGES|SUBTRACT: NOTHING TO CUT|SUBTRACT: [1-9]\d* CUTS?)$/

export function isVerdictAgent(type: unknown): boolean {
  return typeof type === 'string' && VERDICT_AGENTS.has(type.slice(type.lastIndexOf(':') + 1))
}

export function verdictLines(text: string): string[] {
  const found = splitLines(text)
    .map((line) => line.replace(/[*`#>]/g, '').trim())
    .filter((line) => GRAMMAR.test(line))
  return [...new Set(found)]
}
