import { editOf, headerDenial, isDossierPath, markerDenial } from '../engine/guards.ts'
import { byCodePoint, strip } from '../engine/text.ts'

export type Io = {
  isDir: (path: string) => Promise<boolean>
  read: (path: string) => Promise<string>
  exists: (path: string) => Promise<boolean>
  list: (path: string) => Promise<string[]>
  env: (name: 'DOSSIER_MARKER_GUARD' | 'DOSSIER_INVARIANT_GUARD' | 'DOSSIER_FAKEIMPL_CMD') => Promise<string | undefined>
  run: (
    argv: string[],
    init: { stdin: string; timeoutMs: number; cwd?: string },
  ) => Promise<{ exitCode: number; stdout: string; stderr: string }>
  cli?: string
}

export type Verdict = { deny?: string; context?: string }

const INVARIANT_TIMEOUT_MS = 5000
const VERIFY_TIMEOUT_MS = 10_000
const VERIFY_FOOTER = '\nsilence a rule for this write: `# verify-skip: <ruleName>` anywhere in the content.'
const SESSION_TIMEOUT_MS = 60_000
const PROMPT_TIMEOUT_MS = 10_000
const STOP_TIMEOUT_MS = 180_000
const EXIT_NO_NODE = 69
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

const PRIMARY = /^worktree (.+)$/m

export async function ledgerRoot(io: Io, cwd: string): Promise<string> {
  if (await io.isDir(`${cwd}/.scratchpad/dossier`)) return cwd
  try {
    const listed = await io.run(['git', '-C', cwd, 'worktree', 'list', '--porcelain'], { stdin: '', timeoutMs: 5000 })
    const primary = listed.exitCode === 0 ? PRIMARY.exec(listed.stdout)?.[1] : undefined
    return primary && (await io.isDir(`${primary}/.scratchpad/dossier`)) ? primary : cwd
  } catch {
    return cwd
  }
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

export async function verifyGate(io: Io, root: string, input: Record<string, unknown>, fired: Set<string>): Promise<string | undefined> {
  const edit = editOf(input)
  const content = edit?.chunks[0]
  if (!edit || !content || isDossierPath(edit.filePath)) return undefined
  if (!(await io.isDir(`${root}/.scratchpad/dossier`))) return undefined
  let done: { exitCode: number; stdout: string }
  try {
    const argv = ['sh', io.cli ?? 'cli/ds', 'verify-edit', root]
    done = await io.run(argv, { stdin: JSON.stringify({ file_path: edit.filePath, content }), timeoutMs: VERIFY_TIMEOUT_MS })
  } catch {
    return undefined
  }
  if (done.exitCode !== 0 || !done.stdout.trim()) return undefined
  let hits: unknown
  try {
    hits = JSON.parse(done.stdout)
  } catch {
    return undefined
  }
  if (!Array.isArray(hits)) return undefined
  const lines: string[] = []
  for (const hit of hits as { key?: unknown; line?: unknown }[]) {
    if (typeof hit?.key !== 'string' || typeof hit.line !== 'string' || fired.has(hit.key)) continue
    fired.add(hit.key)
    lines.push(hit.line)
  }
  return lines.length ? `${lines.join('\n')}${VERIFY_FOOTER}` : undefined
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

export type SessionVerdict = { context?: string; title?: string; toast?: string }

function parsed(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text)
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function cliFailure(exitCode: number | undefined): string {
  const why = exitCode === EXIT_NO_NODE ? 'needs Node.js 22.18+' : `failed${exitCode === undefined ? '' : ` (exit ${exitCode})`}`
  return `dossier: cli/ds ${why}; stale locks, reconcile and INDEX.md were not refreshed.`
}

export async function sessionGate(io: Io, root: string, input: { source: string; session_title: string }): Promise<SessionVerdict> {
  if (!(await io.isDir(`${root}/.scratchpad/dossier`))) return {}
  let done: { exitCode: number; stdout: string }
  try {
    const argv = ['sh', io.cli ?? 'cli/ds', 'session-start']
    done = await io.run(argv, { stdin: JSON.stringify(input), timeoutMs: SESSION_TIMEOUT_MS, cwd: root })
  } catch {
    return { context: cliFailure(undefined) }
  }
  if (done.exitCode !== 0) return { context: cliFailure(done.exitCode) }
  const output = parsed(done.stdout)
  const nested = output.hookSpecificOutput
  const specific = typeof nested === 'object' && nested !== null ? (nested as Record<string, unknown>) : {}
  const text = (value: unknown): string | undefined => (typeof value === 'string' && value ? value : undefined)
  return { context: text(specific.additionalContext), title: text(specific.sessionTitle), toast: text(output.systemMessage) }
}

export async function promptGate(io: Io, root: string): Promise<string | undefined> {
  if (!(await io.isDir(`${root}/.scratchpad/dossier`))) return undefined
  try {
    const argv = ['sh', io.cli ?? 'cli/ds', 'convergence-state']
    const done = await io.run(argv, { stdin: JSON.stringify({ cwd: root }), timeoutMs: PROMPT_TIMEOUT_MS, cwd: root })
    const text = done.stdout.trim()
    return done.exitCode === 0 && text ? text : undefined
  } catch {
    return undefined
  }
}

export async function stopGate(io: Io, root: string): Promise<string | undefined> {
  if (!(await io.env('DOSSIER_FAKEIMPL_CMD'))?.trim()) return undefined
  try {
    const argv = ['sh', io.cli ?? 'cli/ds', 'fakeimpl']
    const done = await io.run(argv, { stdin: '{}', timeoutMs: STOP_TIMEOUT_MS, cwd: root })
    const output = parsed(done.stdout)
    return done.exitCode === 0 && output.decision === 'block' && typeof output.reason === 'string' ? output.reason : undefined
  } catch {
    return undefined
  }
}
