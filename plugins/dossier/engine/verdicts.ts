import { splitLines } from './text.ts'

const VERDICT_AGENTS = new Set(['whetstone:whetstone-doubter', 'dossier:dossier-reviewer', 'reviewer'])
const GRAMMAR = /^(DOUBT: FAILURES|DOUBT: NO FAILURE FOUND|NO FAILURE FOUND|REVIEW: PASS|REVIEW: CHANGES|SUBTRACT: NOTHING TO CUT|SUBTRACT: [1-9]\d* CUTS?)$/
const REVIEWER = /^REVIEW: (clean|[1-9]\d* findings?)(?=$|[\s(;])/

export function isVerdictAgent(type: unknown): boolean {
  return typeof type === 'string' && VERDICT_AGENTS.has(type)
}

export function verdictLines(text: string, agent?: unknown): string[] {
  const lines = splitLines(text).map((line) => line.replace(/[*`#>]/g, '').trim())
  if (agent === 'reviewer') {
    const last = lines.map((line) => REVIEWER.exec(line)?.[0]).findLast((head) => head !== undefined)
    return last ? [last] : []
  }
  const first = lines.find((line) => GRAMMAR.test(line))
  return first ? [first] : []
}
