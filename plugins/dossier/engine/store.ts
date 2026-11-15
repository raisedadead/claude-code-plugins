import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { header } from './plan.ts'
import { idNumber } from './rows.ts'
import { gitTry, Refusal } from './sh.ts'

export type Dossier = { dir: string; name: string; slug: string; file: string }

export const DATE = /^\d{4}-\d{2}-\d{2}-/
export const REGISTER_HEAD = [
  '# Open work',
  '',
  'This file is the register of all work. Each row is one line:',
  '',
  '`- O<N> <now|next|wait|later|done|drop> <A|H> <title> · <tail>`',
  '',
  '- `now`: the work is in progress.',
  '- `next`: the work is ready to start.',
  '- `wait`: the work waits for a person or an event.',
  '- `later`: the work is not planned yet.',
  '- `done`: the work is finished.',
  '- `drop`: the work is cancelled.',
  '- `A` is an agent. `H` is the operator.',
  '- A paused item is `wait H`. Its tail starts with `paused`.',
  '- A `later` row needs a tail: `until <YYYY-MM-DD>`, `after <dossier-slug>` or `after pr <owner/repo>#<n>`.',
  '- The line of a dossier is the line whose ID the `row:` field of its DOSSIER.md header names.',
  '- To make a new ID by hand, use one more than the highest O number in this file and in every DOSSIER.md under `.scratchpad/dossier/`, live or archived.',
  '',
  '## Rows',
  '',
  '## Notes',
  '',
].join('\n')

export function today(): string {
  return (process.env.DS_TODAY ?? new Date().toISOString()).slice(0, 10)
}

export function now(): string {
  return process.env.DS_NOW ?? new Date().toISOString().slice(0, 16).replace('T', ' ')
}

export function workTree(cwd: string): string {
  const done = gitTry(cwd, 'rev-parse', '--show-toplevel')
  if (done.code !== 0) throw new Refusal('not inside a git repository')
  return done.out.trim()
}

export function ledgerRoot(cwd: string): string {
  if (process.env.DS_ROOT) return process.env.DS_ROOT
  const done = gitTry(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (done.code !== 0) throw new Refusal('not inside a git repository')
  const common = done.out.trim()
  return basename(common) === '.git' ? dirname(common) : workTree(cwd)
}

export const scratch = (root: string): string => join(root, '.scratchpad')
export const dossierHome = (root: string): string => join(scratch(root), 'dossier')
export const registerFile = (root: string): string => join(scratch(root), 'OPEN-WORK.md')

export function read(path: string): string {
  return readFileSync(path, 'utf8')
}

export function readOr(path: string, fallback = ''): string {
  return existsSync(path) ? read(path) : fallback
}

export function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.${process.pid}.tmp`
  writeFileSync(tmp, text.endsWith('\n') ? text : `${text}\n`)
  renameSync(tmp, path)
}

function asDossier(dir: string): Dossier {
  const name = basename(dir)
  return { dir, name, slug: name.replace(DATE, ''), file: join(dir, 'DOSSIER.md') }
}

export function liveDossiers(root: string): Dossier[] {
  const home = dossierHome(root)
  if (!existsSync(home)) return []
  return readdirSync(home, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && DATE.test(entry.name))
    .map((entry) => asDossier(join(home, entry.name)))
    .filter((d) => existsSync(d.file) && header(read(d.file)).state !== 'done')
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function archivedNames(root: string): string[] {
  const home = join(dossierHome(root), '_archive')
  return existsSync(home) ? readdirSync(home) : []
}

export function currentBranch(cwd: string): string {
  const done = gitTry(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD')
  return done.code === 0 ? done.out.trim() : ''
}

export function resolveDossier(cwd: string, wanted?: string): Dossier {
  const root = ledgerRoot(cwd)
  const live = liveDossiers(root)
  const pick = wanted ?? process.env.DS_DOSSIER
  if (pick) {
    const found = live.find((d) => d.name === pick || d.slug === pick)
    if (!found) throw new Refusal(`no live dossier named ${pick}; live: ${live.map((d) => d.slug).join(', ') || 'none'}`)
    return found
  }
  const branch = currentBranch(cwd)
  const byBranch = live.filter((d) => {
    const own = header(read(d.file)).branch
    return own && (branch === own || branch.startsWith(`${own}-lane-`))
  })
  if (byBranch.length === 1 && byBranch[0]) return byBranch[0]
  if (live.length === 1 && live[0]) return live[0]
  if (!live.length) throw new Refusal('no live dossier; start one with ds new <slug>')
  throw new Refusal(`more than one live dossier; name one with --dossier: ${live.map((d) => d.slug).join(', ')}`)
}

export function worklogFile(dossier: Dossier): string {
  return join(dossier.dir, 'worklog.md')
}

export function log(dossier: Dossier, line: string): void {
  const path = worklogFile(dossier)
  const before = readOr(path, `# Worklog: ${dossier.slug}\n\n`)
  write(path, `${before.trimEnd()}\n- ${now()} ${line.replace(/\n/g, ' ')}`)
}

export function worklog(dossier: Dossier): string[] {
  return readOr(worklogFile(dossier))
    .split('\n')
    .filter((line) => line.startsWith('- '))
}

const stateDir = (): string => process.env.DS_STATE_DIR ?? join(homedir(), '.local', 'state', 'ds')

function ledgerFiles(root: string): string[] {
  const files = [registerFile(root)]
  const home = dossierHome(root)
  for (const base of [home, join(home, '_archive')]) {
    if (!existsSync(base)) continue
    for (const name of readdirSync(base)) files.push(join(base, name, 'DOSSIER.md'))
  }
  return files.filter((file) => existsSync(file))
}

export function highestId(root: string): number {
  let high = 0
  for (const file of ledgerFiles(root)) for (const id of read(file).match(/\bO\d+\b/g) ?? []) high = Math.max(high, idNumber(id))
  return high
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

export function nextIds(root: string, count: number, floor = 1): string[] {
  const stored = Number(readOr(join(stateDir(), 'next-id'), '0').trim()) || 0
  const first = Math.max(stored, highestId(root) + 1, floor)
  return Array.from({ length: count }, (_, i) => `O${first + i}`)
}

export function takeIds(root: string, count: number, floor = 1): string[] {
  const dir = stateDir()
  mkdirSync(dir, { recursive: true })
  const lock = join(dir, 'next-id.lock')
  let held = false
  const tries = Math.ceil(Number(process.env.DS_LOCK_MS ?? 5000) / 50)
  for (let n = 0; n < tries && !held; n += 1) {
    try {
      mkdirSync(lock)
      held = true
    } catch {
      sleep(50)
    }
  }
  if (!held) throw new Refusal(`the ID counter is locked; remove ${lock} if no ds command is running`)
  try {
    const ids = nextIds(root, count, floor)
    const last = ids.length ? idNumber(ids[ids.length - 1] ?? 'O0') : Math.max(Number(readOr(join(dir, 'next-id'), '0').trim()) || 0, floor) - 1
    write(join(dir, 'next-id'), String(Math.max(last + 1, floor)))
    return ids
  } finally {
    rmdirSync(lock)
  }
}

export function takeId(root: string): string {
  return takeIds(root, 1)[0] ?? 'O1'
}
