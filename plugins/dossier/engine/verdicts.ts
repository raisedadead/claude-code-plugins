import { splitLines } from './text.ts'

const PLUGIN_REVIEWER = 'whetstone:whetstone-reviewer'
const BULLET_AGENTS = new Set(['whetstone:whetstone-doubter', 'dossier:dossier-reviewer'])
const REVIEW_LINE_AGENTS = new Set(['reviewer', PLUGIN_REVIEWER])
const VERDICT_AGENTS = new Set([...BULLET_AGENTS, ...REVIEW_LINE_AGENTS])
const GRAMMAR = /^(DOUBT: FAILURES|DOUBT: NO FAILURE FOUND|NO FAILURE FOUND|REVIEW: PASS|REVIEW: CHANGES|SUBTRACT: NOTHING TO CUT|SUBTRACT: [1-9]\d* CUTS?)$/
const REVIEWER = /^REVIEW: (clean|[1-9]\d* findings?)(?=$|[\s(;])/
const PATH_FINDING = /^\S+:\d+: (blocker|major|minor|note): \S/
const CAVEATS = /^#{1,6}\s*Caveats\b/i
const MAX_FINDINGS = 20
const MAX_FINDING_CHARS = 200

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
  if (typeof agent === 'string' && REVIEW_LINE_AGENTS.has(agent)) {
    const last = lines.map((line) => REVIEWER.exec(line)?.[0]).findLast((head) => head !== undefined)
    return last ? [last] : []
  }
  const first = lines.find((line) => GRAMMAR.test(line))
  return first ? [first] : []
}

function capped(findings: string[]): string[] {
  return findings.slice(0, MAX_FINDINGS).map((finding) => finding.slice(0, MAX_FINDING_CHARS))
}

function bulletsAfterVerdict(lines: string[]): string[] {
  const start = lines.findIndex((line) => GRAMMAR.test(line.replace(/[*`#>]/g, '').trim()))
  if (start < 0) return []
  const rest = lines.slice(start + 1)
  const end = rest.findIndex((line) => CAVEATS.test(line))
  return (end < 0 ? rest : rest.slice(0, end)).filter((line) => line.startsWith('- ')).map((line) => line.slice(2).trim())
}

export function findingLines(text: string, agent?: unknown): string[] {
  const lines = splitLines(text).map((line) => line.trim())
  if (agent === PLUGIN_REVIEWER) return capped(lines.filter((line) => PATH_FINDING.test(line)))
  if (typeof agent === 'string' && BULLET_AGENTS.has(agent)) return capped(bulletsAfterVerdict(lines))
  return []
}

function pathFinding(item: unknown): string[] {
  if (typeof item !== 'object' || item === null) return []
  const { file, line, severity, problem } = item as Record<string, unknown>
  if (typeof file !== 'string' || typeof line !== 'number' || typeof severity !== 'string' || typeof problem !== 'string') return []
  return [`${file}:${line}: ${severity}: ${problem}`]
}

export function structuredFindings(output: unknown, agent?: unknown): string[] {
  if (agent !== PLUGIN_REVIEWER || typeof output !== 'object' || output === null) return []
  const { findings } = output as Record<string, unknown>
  return Array.isArray(findings) ? capped(findings.flatMap(pathFinding)) : []
}
