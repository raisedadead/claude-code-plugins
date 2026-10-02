import { editOf, headerDenial, isDossierPath, markerDenial } from '../engine/guards.ts'
import { byCodePoint, strip } from '../engine/text.ts'

export type Io = {
  isDir: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  list: (path: string) => Promise<string[]>
  env: (name: 'DOSSIER_MARKER_GUARD' | 'DOSSIER_INVARIANT_GUARD') => Promise<string | undefined>
  run: (argv: string[], init: { stdin: string; timeoutMs: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  cli?: string
}

export type Verdict = { deny?: string; context?: string }

const INVARIANT_TIMEOUT_MS = 5000
export const BUILTINS = new Set(['code-review', 'review', 'security-review', 'simplify'])
const CLOSE = 'dossier:close'
export const WHETSTONE = new Set([
  'whetstone:doubt-pass',
  'whetstone:flaky-test-audit',
  'whetstone:merge-resolve',
  'whetstone:skill-smith',
  'whetstone:tdd-cycle',
  'whetstone:tiger-style',
])

async function invariantGate(io: Io, root: string, filePath: string, chunks: string[]): Promise<Verdict> {
  if ((await io.env('DOSSIER_INVARIANT_GUARD')) === 'off') return {}
  if (!(await io.exists(`${root}/.scratchpad/dossier/.invariant-guards.json`))) return {}
  try {
    const argv = ['sh', io.cli ?? 'cli/ds', 'invariant-check', root]
    const done = await io.run(argv, { stdin: JSON.stringify({ file_path: filePath, chunks }), timeoutMs: INVARIANT_TIMEOUT_MS })
    const text = done.stdout.trim()
    if (done.exitCode === 1 && text) return { deny: text }
    if (done.exitCode === 0 && text) return { context: text }
  } catch {
    return {}
  }
  return {}
}

export async function editGate(io: Io, root: string, input: Record<string, unknown>): Promise<Verdict> {
  const edit = editOf(input)
  if (!edit) return {}
  if (!(await io.isDir(`${root}/.scratchpad/dossier`))) return {}
  const guarded = (await io.env('DOSSIER_MARKER_GUARD')) !== 'off'
  const header = guarded ? headerDenial(edit) : undefined
  if (header) return { deny: header }
  if (isDossierPath(edit.filePath)) return {}
  const marker = guarded ? markerDenial(edit) : undefined
  if (marker) return { deny: marker }
  return invariantGate(io, root, edit.filePath, edit.chunks)
}

function rows(index: string, state: string): string[] {
  return index
    .split('\n')
    .map((line) => line.split('|').map(strip))
    .filter((cells) => cells.length > 3 && cells[3] === state)
    .map((cells) => `${cells[1]}-${cells[2]}`)
}

async function inFlight(io: Io, root: string, live: string[]): Promise<string | undefined> {
  const dossiers = `${root}/.scratchpad/dossier`
  let names: string[]
  try {
    names = (await io.list(dossiers)).sort(byCodePoint)
  } catch {
    return undefined
  }
  for (const name of names) {
    if (!live.includes(name)) continue
    const lockPath = `${dossiers}/${name}/.ds-lock`
    if (!(await io.exists(lockPath))) continue
    let text: string
    try {
      text = await io.read(lockPath)
    } catch {
      return name
    }
    try {
      const data: unknown = JSON.parse(text)
      if (typeof data !== 'object' || data === null || Array.isArray(data)) return name
      const lock = data as Record<string, unknown>
      return `${name}: ${String(lock.skill ?? '?')} ${String(lock.target ?? '?')}`
    } catch {
      return name
    }
  }
  return undefined
}

function reminder(name: string, paused: string[], live: string | undefined, flight: string | undefined): string | undefined {
  if (name === CLOSE && paused.length) {
    return (
      `${paused.length} paused dossier(s) alongside this close: ${paused.join(', ')}. Decide each one ` +
      'before the tree loses its current reader — resume it, or close it with ds:close --abandon ' +
      '"<reason>". Reminder only, never blocking.'
    )
  }
  if (BUILTINS.has(name) && flight) {
    return (
      `live dossier build in flight (${flight}) — fold /${name} findings into the ds:build step 6.5 ` +
      'artifact trail and record the verdict in §S. Reminder only, never blocking.'
    )
  }
  if (WHETSTONE.has(name) && live) {
    return (
      `live dossier (${live}) — after this skill's verdict, record the §S line this skill's own rule ` +
      "calls for via dossier's cli/ds s-append (first live row = current; main thread writes, never " +
      'subagents). Reminder only, never blocking.'
    )
  }
  return undefined
}

export async function skillGate(io: Io, root: string, name: string, seen: Set<string>): Promise<string | undefined> {
  if (!BUILTINS.has(name) && !WHETSTONE.has(name) && name !== CLOSE) return undefined
  if (seen.has(name)) return undefined
  let index: string
  try {
    index = await io.read(`${root}/.scratchpad/INDEX.md`)
  } catch {
    return undefined
  }
  const live = rows(index, 'live')
  const paused = name === CLOSE ? rows(index, 'paused') : []
  const flight = BUILTINS.has(name) && live.length ? await inFlight(io, root, live) : undefined
  const text = reminder(name, paused, live[0], flight)
  if (text) seen.add(name)
  return text
}

export function skillOf(input: Record<string, unknown>): string {
  return String(input.skill || input.name || '')
}
