import { splitLines } from './text.ts'

const VERDICT_AGENTS = new Set(['whetstone:whetstone-doubter', 'dossier:dossier-reviewer', 'reviewer'])
const GRAMMAR = /^(DOUBT: FAILURES|DOUBT: NO FAILURE FOUND|NO FAILURE FOUND|REVIEW: PASS|REVIEW: CHANGES|SUBTRACT: NOTHING TO CUT|SUBTRACT: [1-9]\d* CUTS?)$/
const REVIEWER = /^REVIEW: (clean|[1-9]\d* findings?)(?=$|[\s(;])/

export function isVerdictAgent(type: unknown): boolean {
  return typeof type === 'string' && VERDICT_AGENTS.has(type)
}

export function structuredVerdicts(output: unknown): string[] {
  if (typeof output !== 'object' || output === null) return []
  const { findings, real, verdicts } = output as Record<string, unknown>
  if (Array.isArray(findings)) {
    const count = findings.length
    return [count === 0 ? 'REVIEW: clean' : `REVIEW: ${count} finding${count === 1 ? '' : 's'}`]
  }
  if (typeof real === 'boolean') return [findingVerdict(real)]
  if (Array.isArray(verdicts)) return verdicts.flatMap((item: unknown) => (isJudged(item) ? [findingVerdict(item.real)] : []))
  return []
}

function isJudged(item: unknown): item is { real: boolean } {
  return typeof item === 'object' && item !== null && typeof (item as Record<string, unknown>).real === 'boolean'
}

function findingVerdict(real: boolean): string {
  return real ? 'FINDING: real' : 'FINDING: not real'
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
