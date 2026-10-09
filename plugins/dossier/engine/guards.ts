import { compilePython, fnmatch } from './pyregex.ts'
import { HEADER } from './ledger.ts'
import { splitLines, strip, unicodeRegex } from './text.ts'

const COMMENT_PREFIX = String.raw`^\s*(?://+|#+|--|/\*+|\*(?!/)|<!--|;)\s*`
const MARKER_PATTERNS = [
  unicodeRegex(COMMENT_PREFIX + String.raw`.*\bPH\d+-[A-Z]\d+\b`),
  unicodeRegex(COMMENT_PREFIX + '.*§[VBTSXGZ]\\d+'),
]
const CANONICAL_STATES = new Set(['live', 'done', 'paused'])

export type Edit = { filePath: string; chunks: string[] }

export type Guard = { id?: unknown; pattern?: unknown; message?: unknown; paths?: unknown }

function posix(path: string): string {
  const absolute = path.startsWith('/')
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  const joined = parts.join('/')
  return absolute ? `/${joined}` : joined || '.'
}

function baseName(path: string): string {
  return posix(path).split('/').pop() ?? ''
}

export function editOf(input: Record<string, unknown>): Edit | undefined {
  if (input.tool !== 'Edit' && input.tool !== 'Write') return undefined
  const path = input.file_path || input.path
  if (!path) return undefined
  const text = input.tool === 'Write' ? input.content : input.new_string
  if (typeof text !== 'string') return undefined
  return { filePath: String(path), chunks: [text] }
}

export function isDossierPath(path: string): boolean {
  return posix(path).includes('.scratchpad/') || baseName(path) === 'DOSSIER.md'
}

export function headerDenial({ filePath, chunks }: Edit): string | undefined {
  if (baseName(filePath) !== 'DOSSIER.md') return undefined
  for (const line of chunks.flatMap(splitLines)) {
    const token = strip(HEADER.exec(line)?.[1] ?? '')
    if (token && !CANONICAL_STATES.has(token)) {
      return (
        `dossier: refusing to write non-canonical header state '${token}'.\n` +
        '  canonical header states: live | done | paused.\n' +
        '  route header changes through cli/ds header-state ' +
        '(ds:close flips done; ds:status pause/resume) — not a raw Edit/Write.'
      )
    }
  }
  return undefined
}

export function markerDenial({ filePath, chunks }: Edit): string | undefined {
  const line = chunks.flatMap(splitLines).find((text) => MARKER_PATTERNS.some((pattern) => pattern.test(text)))
  if (line === undefined) return undefined
  return [
    `dossier marker guard: '${filePath}' carries a dossier audit-id marker.`,
    `  offending line: ${strip(line)}`,
    '',
    'Audit-id markers (`PH3-B7`) and §-cites (`§V26`) belong in the',
    'DOSSIER.md §B/§V ledger + commit trailer, not source. Drop the',
    'marker; keep any why-tail (workaround ref, invariant, upstream-bug',
    'link). Bypass: DOSSIER_MARKER_GUARD=off.',
  ].join('\n')
}

function inScope(path: string, paths: unknown): boolean {
  if (!Array.isArray(paths) || paths.length === 0) return true
  return paths.some((glob) => typeof glob === 'string' && fnmatch(posix(path), glob))
}

export function parseRegistry(text: string): Guard[] {
  try {
    const data: unknown = JSON.parse(text)
    if (!Array.isArray(data)) return []
    return data.filter((entry): entry is Guard => typeof entry === 'object' && entry !== null && !Array.isArray(entry))
  } catch {
    return []
  }
}

export function invariantVerdict({ filePath, chunks }: Edit, registry: Guard[]): { deny?: string; skipped: string[] } {
  const skipped: string[] = []
  for (const entry of registry) {
    if (typeof entry.pattern !== 'string' || !entry.pattern) continue
    if (!inScope(filePath, entry.paths)) continue
    const compiled = compilePython(entry.pattern)
    if (!compiled) {
      skipped.push(String(entry.id ?? '?'))
      continue
    }
    if (chunks.some((chunk) => compiled.test(chunk))) {
      const deny =
        `dossier invariant guard: edit to '${filePath}' violates §V ${String(entry.id ?? '?')}.\n` +
        `  pattern: ${entry.pattern}\n` +
        `  ${String(entry.message ?? '')}\n` +
        '  registered by ds:backprop (recurrence=high). Legit edit? set ' +
        'DOSSIER_INVARIANT_GUARD=off and log the rationale in §S.'
      return { deny, skipped }
    }
  }
  return { skipped }
}

export function skippedAdvisory(skipped: string[]): string {
  return (
    `dossier invariant guard: §V ${skipped.join(', ')} not checked — the pattern has no ECMAScript ` +
    'meaning. Re-register it in JS regex syntax in .scratchpad/dossier/.invariant-guards.json.'
  )
}
