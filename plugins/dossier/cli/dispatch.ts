import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { convergenceStateVerb, convergeVerb } from './converge.ts'
import { claimRoots } from './env.ts'
import { resolvePinsVerb, verifyEditVerb, verifySweepVerb } from './verify.ts'
import { invariantVerdict, parseRegistry, skippedAdvisory } from '../engine/guards.ts'
import { sessionReport } from '../engine/session.ts'
import { splitLines, strip } from '../engine/text.ts'
import {
  changelogInsert,
  hasRepo,
  headerState,
  headerToken,
  type IndexRow,
  indexRow,
  lines,
  missingSections,
  renderIndex,
  rowFlip,
  sAppend,
  unlines,
  vmFindings,
  xRefresh,
  zClosed,
  zWrite,
} from '../engine/ledger.ts'

const EXIT_USAGE = 64
const STALE_SECONDS = 1800

class Refusal extends Error {
  readonly code: number

  constructor(message: string, code = 1) {
    super(message)
    this.code = code
  }
}

function refuse(verb: string, message: string, code = 1): never {
  throw new Refusal(`ds ${verb}: ${message}`, code)
}

function required(verb: string, value: string | undefined, usage: string): string {
  if (!value) refuse(verb, `usage: ${usage}`)
  return value
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function stamp(date: Date, seconds = false): string {
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return seconds ? `${day} ${time}:${pad(date.getSeconds())}` : `${day} ${time}`
}

function tempName(file: string, infix = ''): string {
  return `${file}.${infix}${randomBytes(3).toString('hex')}`
}

function atomicWrite(file: string, text: string, temp = tempName(file)): void {
  writeFileSync(temp, text, { flag: 'wx' })
  try {
    renameSync(temp, file)
  } catch (error) {
    rmSync(temp, { force: true })
    throw error
  }
}

function dossierFile(dir: string): string {
  return `${dir.replace(/\/$/, '')}/DOSSIER.md`
}

function readDossier(verb: string, dir: string): [string, string] {
  const file = dossierFile(dir)
  if (!isFile(file)) refuse(verb, `not found: ${file}`)
  return [file, readFileSync(file, 'utf8')]
}

function subdirs(parent: string): string[] {
  let names: string[]
  try {
    names = readdirSync(parent)
  } catch {
    return []
  }
  return names.filter((name) => !name.startsWith('.') && isDir(join(parent, name))).sort()
}

function walk(root: string): string[] {
  const out: string[] = []
  const visit = (dir: string): void => {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = `${dir}/${entry.name}`
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) out.push(path)
    }
  }
  visit(root.replace(/\/+$/, '') || '/')
  return out.sort()
}

function git(repo: string, ...args: string[]): { ok: boolean; out: string } {
  const done = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  return { ok: done.status === 0, out: (done.stdout ?? '').replace(/\n+$/, '') }
}

function rowFlipVerb(args: string[]): number {
  const usage = 'ds row-flip <dossier-dir> <row-id> <new-state> [cite]'
  const dir = required('row-flip', args[0], usage)
  const id = required('row-flip', args[1], 'row-id required (e.g. T3)')
  const state = required('row-flip', args[2], 'new-state required (. ~ x ! ?)')
  const cite = args[3] ?? ''
  const [file, text] = readDossier('row-flip', dir)
  if (!['.', '~', 'x', '!', '?'].includes(state)) refuse('row-flip', `invalid state "${state}" (want . ~ x ! ?)`)
  if (/^B[0-9]/.test(id)) refuse('row-flip', 'refuses Bugs rows (no state column — would destroy cells); use ds:backprop')
  const result = rowFlip(text, file, id, state, cite)
  if ('error' in result) refuse('row-flip', result.error)
  atomicWrite(file, result.text)
  return 0
}

function sAppendTo(dir: string, event: string): void {
  const [file, text] = readDossier('s-append', dir)
  const entry = `${stamp(new Date(), process.env.DS_TS_SECONDS === '1')} ${event}`
  atomicWrite(file, sAppend(text, entry))
}

function sAppendVerb(args: string[]): number {
  const dir = required('s-append', args[0], 'ds s-append <dossier-dir> <event-text...>')
  const event = args.slice(1).join(' ')
  if (!event) refuse('s-append', 'empty event text')
  sAppendTo(dir, event)
  return 0
}

function setHeader(dir: string, state: string): void {
  const [file, text] = readDossier('header-state', dir)
  if (!['live', 'done', 'paused'].includes(state)) refuse('header-state', `invalid state "${state}" (want live|done|paused)`)
  const next = headerState(text, state)
  if (next === undefined) refuse('header-state', `header metadata line not found in ${file}`)
  atomicWrite(file, next)
}

function headerStateVerb(args: string[]): number {
  const dir = required('header-state', args[0], 'ds header-state <dossier-dir> <live|done|paused>')
  setHeader(dir, required('header-state', args[1], 'new-state required (live|done|paused)'))
  return 0
}

function xRefreshVerb(args: string[]): number {
  const dir = required('x-refresh', args[0], 'ds x-refresh <dossier-dir> <repo-label> <repo-path>')
  const label = required('x-refresh', args[1], 'repo-label required (matches §X col 1)')
  const repo = required('x-refresh', args[2], 'repo-path required')
  const [file, text] = readDossier('x-refresh', dir)
  if (!git(repo, 'rev-parse', '--git-dir').ok) refuse('x-refresh', `not a git repo: ${repo}`)
  if (!hasRepo(text, label)) refuse('x-refresh', `repo ${label} not found in §X of ${file}`)
  const head = git(repo, 'rev-parse', '--abbrev-ref', 'HEAD')
  const branch = head.ok ? head.out : '—'
  let ahead = 'no-upstream'
  let pushed = 'no'
  if (git(repo, 'rev-parse', '--verify', '-q', `origin/${branch}`).ok) {
    const count = git(repo, 'rev-list', '--count', `origin/${branch}..HEAD`)
    ahead = count.ok ? count.out : '?'
    pushed = ahead === '0' ? 'yes' : 'no'
  }
  const described = git(repo, 'describe', '--tags', '--abbrev=0')
  const tag = described.ok ? described.out : '—'
  atomicWrite(file, xRefresh(text, label, [branch, ahead, tag, pushed]))
  return 0
}

function zWriteVerb(args: string[]): number {
  const usage = 'ds z-write <dossier-dir> <complete|successor|abandoned> <value> <summary> [cites]'
  const dir = required('z-write', args[0], usage)
  const kind = required('z-write', args[1], 'kind required (complete|successor|abandoned)')
  const [file, text] = readDossier('z-write', dir)
  const result = zWrite(text, file, kind, args[2] ?? '', args[3] ?? '', args[4] || '—', stamp(new Date()))
  if ('error' in result) refuse('z-write', result.error)
  atomicWrite(file, result.text)
  return 0
}

function archiveMove(source: string, parent: string): void {
  const src = source.replace(/\/$/, '')
  const archive = parent.replace(/\/$/, '')
  const dest = `${archive}/${basename(src)}`
  if (!existsSync(src) && isFile(`${dest}/DOSSIER.md`)) return
  if (!isDir(src)) refuse('archive-move', `src not a directory: ${src}`)
  if (!isFile(`${src}/DOSSIER.md`)) refuse('archive-move', `no DOSSIER.md in src: ${src}`)
  if (existsSync(dest)) refuse('archive-move', `dest already exists, refusing (would nest): ${dest}`)
  try {
    mkdirSync(archive, { recursive: true })
  } catch {
    refuse('archive-move', `cannot create archive parent: ${archive}`)
  }
  try {
    renameSync(src, dest)
  } catch {
    refuse('archive-move', `mv failed, src preserved: ${src} -> ${dest}`)
  }
  if (isFile(`${dest}/DOSSIER.md`) && !existsSync(src)) return
  refuse('archive-move', `post-move assertion failed: ${dest}`)
}

function archiveMoveVerb(args: string[]): number {
  const src = required('archive-move', args[0], 'ds archive-move <src-dossier-dir> <archive-parent-dir>')
  archiveMove(src, required('archive-move', args[1], 'archive-parent dir required'))
  return 0
}

function assertScaffoldVerb(args: string[]): number {
  const arg = required('assert-scaffold', args[0], 'ds assert-scaffold <dossier-dir-or-DOSSIER.md>')
  const file = isDir(arg) ? dossierFile(arg) : arg
  if (!isFile(file)) refuse('assert-scaffold', `no DOSSIER.md at: ${file}`)
  const missing = missingSections(readFileSync(file, 'utf8'))
  if (missing.length) {
    refuse('assert-scaffold', `DOSSIER.md missing required section(s): ${missing.join(' ')}\n  file: ${file}`)
  }
  return 0
}

function assertGrillVerb(args: string[]): number {
  const consume = args[0] === '--consume'
  const rest = consume ? args.slice(1) : args
  if (rest.length !== (consume ? 3 : 2)) {
    throw new Refusal(
      'usage: ds assert-grill <scratchpad-root> <slug> | --consume <scratchpad-root> <slug> <dossier-dir-key>',
      EXIT_USAGE,
    )
  }
  const [root = '', slug = '', key = ''] = rest
  const dir = `${root}/dossier/.grill`
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    names = []
  }
  const pattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-/
  const matches = names.filter((name) => pattern.test(name) && name.slice(11) === `${slug}.md`).map((name) => `${dir}/${name}`)
  if (!matches.length) throw new Refusal(`grill artifact missing for slug ${slug}`)
  const grill = matches.reduce((best, path) => (path > best ? path : best))
  const rows = lines(readFileSync(grill, 'utf8'))
  const consumed = rows.find((row) => row.startsWith('CONSUMED: '))
  if (consumed !== undefined) {
    throw new Refusal(`grill artifact already consumed: ${grill} (${consumed}) — run ds:grill ${slug} for a fresh one`, 4)
  }
  if (!rows.some((row) => /^FRONTIER: (empty|empty-except-external n=[0-9]+)$/.test(row))) {
    throw new Refusal(`grill incomplete: no closed FRONTIER footer in ${grill} (finish via ds:grill --resume)`, 2)
  }
  if (!rows.some((row) => row.startsWith('CONFIRMED: '))) {
    throw new Refusal(`grill unconfirmed: no CONFIRMED footer in ${grill} (operator confirmation required)`, 3)
  }
  if (consume) {
    const temp = tempName(grill, 'tmp.')
    copyFileSync(grill, temp)
    appendFileSync(temp, `CONSUMED: ${key}\n`)
    renameSync(temp, grill)
  }
  console.log(grill)
  return 0
}

function changelogWriteVerb(args: string[]): number {
  const [changelog = '', section = '', key = ''] = args
  if (args.length !== 3 || !isFile(section)) {
    throw new Refusal('usage: ds changelog-write <changelog-path> <section-file> <idempotency-key>', EXIT_USAGE)
  }
  if (!isFile(changelog)) throw new Refusal(`changelog missing: ${changelog} (scaffold it first)`)
  const text = readFileSync(changelog, 'utf8')
  const keys = key.split('\n')
  if (lines(text).some((row) => keys.some((part) => row.includes(part)))) {
    throw new Refusal(`section already present (key ${key}) in ${changelog} — refusing duplicate write`, 3)
  }
  const body = unlines(lines(readFileSync(section, 'utf8')))
  atomicWrite(changelog, changelogInsert(text, body), tempName(changelog, 'tmp.'))
  console.log(changelog)
  return 0
}

function lockFields(path: string): { pid: string; started: string } {
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { pid: '', started: '' }
    const lock = data as Record<string, unknown>
    const field = (value: unknown): string => (value === undefined || value === null || value === false ? '' : String(value))
    return { pid: field(lock.pid), started: field(lock.started) }
  } catch {
    return { pid: '', started: '' }
  }
}

function alive(pid: string): boolean {
  if (!/^[0-9]+$/.test(pid)) return false
  try {
    process.kill(Number(pid), 0)
    return true
  } catch {
    return false
  }
}

function startedEpoch(path: string, started: string): number | undefined {
  const strict = /^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})Z$/.exec(started)
  if (strict) {
    const [, y, mo, d, h, mi, s] = strict.map(Number)
    return Math.floor(Date.UTC(y ?? 0, (mo ?? 1) - 1, d, h, mi, s) / 1000)
  }
  try {
    return Math.floor(statSync(path).mtimeMs / 1000)
  } catch {
    return undefined
  }
}

function staleLocks(dossierDir: string): [string, string][] {
  if (!isDir(dossierDir)) return []
  const now = Math.floor(Date.now() / 1000)
  const stale: [string, string][] = []
  for (const path of walk(dossierDir).filter((file) => basename(file) === '.ds-lock')) {
    const { pid, started } = lockFields(path)
    if (pid) {
      if (!alive(pid)) stale.push([path, 'pid-dead'])
      continue
    }
    const epoch = startedEpoch(path, started)
    if (epoch !== undefined && now - epoch > STALE_SECONDS) stale.push([path, `stale-${now - epoch}s`])
  }
  return stale
}

function clearLocks(dossierDir: string, dryRun: boolean): string[] {
  const out: string[] = []
  for (const [path, reason] of staleLocks(dossierDir)) {
    if (dryRun) out.push(`would clear stale lock: ${path} (${reason})`)
    else {
      rmSync(path, { force: true })
      console.error(`cleared stale lock: ${path} (${reason})`)
    }
  }
  return out
}

function clearLocksVerb(args: string[]): number {
  const dryRun = args.includes('--dry-run')
  const dir = args.filter((arg) => arg !== '--dry-run').pop() || '.scratchpad/dossier'
  for (const line of clearLocks(dir, dryRun)) console.log(line)
  return 0
}

function quietly(action: () => void): boolean {
  try {
    action()
    return true
  } catch {
    return false
  }
}

function reconcileVerb(args: string[]): number {
  const scratchpad = args[0] || '.scratchpad'
  const dossiers = `${scratchpad}/dossier`
  const archive = `${dossiers}/_archive`
  if (!isDir(dossiers)) return 0
  for (const name of subdirs(dossiers)) {
    if (name === '_archive') continue
    const dir = `${dossiers}/${name}`
    if (!isFile(`${dir}/DOSSIER.md`) || existsSync(`${dir}/.ds-lock`)) continue
    if (!zClosed(readFileSync(`${dir}/DOSSIER.md`, 'utf8'))) continue
    if (quietly(() => archiveMove(dir, archive))) {
      quietly(() => setHeader(`${archive}/${name}`, 'done'))
      quietly(() =>
        sAppendTo(`${archive}/${name}`, 'ds:reconcile — auto-archived closed dossier (§Z-backed, was not under _archive)'),
      )
    }
  }
  for (const name of subdirs(archive)) {
    const file = `${archive}/${name}/DOSSIER.md`
    if (!isFile(file)) continue
    if (headerToken(readFileSync(file, 'utf8')) !== 'done') quietly(() => setHeader(`${archive}/${name}`, 'done'))
  }
  return 0
}

function mtimeOf(path: string): string {
  try {
    return stamp(statSync(path).mtime)
  } catch {
    return '—'
  }
}

function regenIndex(scratchpad: string): void {
  const dossiers = `${scratchpad}/dossier`
  if (!isDir(dossiers)) return
  const rows: IndexRow[] = []
  const add = (parent: string, name: string, archived: boolean): void => {
    const file = `${parent}/${name}/DOSSIER.md`
    if (!isFile(file)) return
    const row = indexRow(name, readFileSync(file, 'utf8'), archived, mtimeOf(file))
    if (row.warning) console.error(`ds regen-index: ${file}: ${row.warning}`)
    rows.push(row)
  }
  for (const name of subdirs(dossiers)) if (name !== '_archive') add(dossiers, name, false)
  for (const name of subdirs(`${dossiers}/_archive`)) add(`${dossiers}/_archive`, name, true)
  atomicWrite(`${scratchpad}/INDEX.md`, renderIndex(rows))
}

function regenIndexVerb(args: string[]): number {
  regenIndex(args[0] || '.scratchpad')
  return 0
}

function dsCheckVerb(args: string[]): number {
  const scratchpad = args[0] || '.scratchpad'
  regenIndex(scratchpad)
  const index = `${scratchpad}/INDEX.md`
  if (!isFile(index)) return 0
  const drift = /<!-- drift:([0-9]+) slugs:([^>]*) -->/.exec(readFileSync(index, 'utf8'))
  if (!drift) return 0
  console.error(`ds:check: Vm.1/Vm.4 DRIFT — ${drift[1]} dossier(s) with header/location/§Z disagreement: ${drift[2]}`)
  console.error('reconcile: session-start self-heals §Z-closed drift; otherwise finish the close (ds:close --resume) or fix the header token.')
  return 1
}

function vmChecksVerb(args: string[]): number {
  const root = args[0] || '.scratchpad'
  const tree = `${root.replace(/\/$/, '')}/dossier`
  if (!isDir(tree)) return 0
  const files = walk(tree)
  const findings: string[] = []
  for (const file of files.filter((path) => basename(path) === 'DOSSIER.md')) {
    findings.push(...vmFindings(file, readFileSync(file, 'utf8')))
  }
  for (const file of files) {
    const name = basename(file)
    if (name.endsWith('.tmp') || name.startsWith('DOSSIER.md.') || name.startsWith('INDEX.md.')) {
      findings.push(`WARN Vm.8 orphan temp file: ${file}`)
    }
  }
  for (const line of clearLocks(tree, true)) findings.push(`WARN Vm.9 ${line}`)
  if (!findings.length) return 0
  process.stdout.write(unlines(findings))
  return 1
}

function invariantCheckVerb(args: string[]): number {
  const [root] = args
  if (root === undefined) throw new Refusal('usage: ds invariant-check <project-root> < {"file_path", "chunks"}', EXIT_USAGE)
  let registryText: string
  try {
    registryText = readFileSync(join(root, '.scratchpad/dossier/.invariant-guards.json'), 'utf8')
  } catch {
    return 0
  }
  let payload: unknown
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return 0
  }
  const { file_path: filePath, chunks } = (payload ?? {}) as { file_path?: unknown; chunks?: unknown }
  if (typeof filePath !== 'string' || !Array.isArray(chunks)) return 0
  const verdict = invariantVerdict({ filePath, chunks: chunks.map(String) }, parseRegistry(registryText))
  if (verdict.deny) {
    console.log(verdict.deny)
    return 1
  }
  if (verdict.skipped.length) console.log(skippedAdvisory(verdict.skipped))
  return 0
}

function stdinPayload(): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(readFileSync(0, 'utf8'))
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function text(value: unknown): string {
  return value ? String(value) : ''
}

function sessionStartVerb(): number {
  const scratchpad = '.scratchpad'
  const dossiers = `${scratchpad}/dossier`
  if (!isDir(dossiers)) {
    console.log(JSON.stringify({ continue: true }))
    return 0
  }
  const payload = stdinPayload()
  quietly(() => clearLocks(dossiers, false))
  quietly(() => reconcileVerb([scratchpad]))
  quietly(() => regenIndex(scratchpad))
  const index = `${scratchpad}/INDEX.md`
  const ledgers = subdirs(dossiers)
    .filter((name) => name !== '_archive' && isFile(`${dossiers}/${name}/DOSSIER.md`))
    .map((name) => ({ name, text: readFileSync(`${dossiers}/${name}/DOSSIER.md`, 'utf8') }))
  const report = sessionReport({
    index: isFile(index) ? readFileSync(index, 'utf8') : undefined,
    ledgers,
    source: text(payload.source),
    title: text(payload.session_title),
    titleFlag: process.env.DOSSIER_SESSION_TITLE ?? '0',
    nudgeFlag: process.env.DOSSIER_LIVE_NUDGE ?? '1',
  })
  const specific = { hookEventName: 'SessionStart', additionalContext: report.context, ...(report.title ? { sessionTitle: report.title } : {}) }
  console.log(JSON.stringify({ continue: true, hookSpecificOutput: specific, ...(report.system ? { systemMessage: report.system } : {}) }))
  return 0
}

function scratchpadEntry(entry: string): boolean {
  let path = entry.length > 3 ? entry.slice(3).trim() : ''
  if (path.includes(' -> ')) path = path.slice(path.lastIndexOf(' -> ') + 4)
  return path.trim().replace(/^"+|"+$/g, '').split('/').includes('.scratchpad')
}

function fakeimplVerb(): number {
  const command = (process.env.DOSSIER_FAKEIMPL_CMD ?? '').trim()
  if (!command) return 0
  const status = spawnSync('git', ['status', '--porcelain', '-uall'], { encoding: 'utf8', timeout: 10_000, maxBuffer: 64 * 1024 * 1024 })
  if (status.error) return 0
  const dirty = (status.stdout ?? '').split('\n').filter((line) => line.trim() && !scratchpadEntry(line))
  if (!dirty.length) return 0
  const raw = (process.env.DOSSIER_FAKEIMPL_TIMEOUT ?? '120').trim()
  const timeout = /^[+-]?[0-9]+$/.test(raw) ? Number(raw) : 120
  const block = (reason: string): number => {
    console.log(JSON.stringify({ decision: 'block', reason }))
    return 0
  }
  const timedOut = (): number =>
    block(`fake-impl backstop: \`${command}\` timed out after ${timeout}s — verify the change actually runs before finishing, or unset DOSSIER_FAKEIMPL_CMD.`)
  if (timeout <= 0) return timedOut()
  const capture = mkdtempSync(join(tmpdir(), 'ds-fakeimpl-'))
  try {
    const out = openSync(join(capture, 'out'), 'w')
    const err = openSync(join(capture, 'err'), 'w')
    const run = spawnSync('/bin/sh', ['-c', command], { stdio: ['ignore', out, err], timeout: timeout * 1000, killSignal: 'SIGKILL' })
    closeSync(out)
    closeSync(err)
    if ((run.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') return timedOut()
    if (run.error) return 0
    const code = run.signal ? -(constants.signals[run.signal] ?? 1) : (run.status ?? 1)
    if (code === 0) return 0
    const output = `${readFileSync(join(capture, 'out'), 'utf8')}${readFileSync(join(capture, 'err'), 'utf8')}`.replace(/\r\n?/g, '\n')
    const tail = splitLines(strip(output)).slice(-8).join('\n')
    return block(`fake-impl backstop: \`${command}\` failed (exit ${code}) on a dirty tree — the change is not verified:\n${tail}`)
  } finally {
    rmSync(capture, { recursive: true, force: true })
  }
}

const VERBS: Record<string, (args: string[]) => number | Promise<number>> = {
  'archive-move': archiveMoveVerb,
  'assert-grill': assertGrillVerb,
  'assert-scaffold': assertScaffoldVerb,
  'changelog-write': changelogWriteVerb,
  'clear-locks': clearLocksVerb,
  converge: convergeVerb,
  'convergence-state': convergenceStateVerb,
  'ds-check': dsCheckVerb,
  fakeimpl: fakeimplVerb,
  'header-state': headerStateVerb,
  'invariant-check': invariantCheckVerb,
  reconcile: reconcileVerb,
  'resolve-pins': resolvePinsVerb,
  'regen-index': regenIndexVerb,
  'row-flip': rowFlipVerb,
  'session-start': sessionStartVerb,
  's-append': sAppendVerb,
  'verify-edit': verifyEditVerb,
  'verify-sweep': verifySweepVerb,
  'vm-checks': vmChecksVerb,
  'x-refresh': xRefreshVerb,
  'z-write': zWriteVerb,
}

const PRIMARY = /^worktree (.+)$/m
const GIT_TIMEOUT_MS = 5000
const LEDGER_VERBS = new Set(['archive-move', 'assert-grill', 'assert-scaffold', 'clear-locks', 'ds-check', 'header-state', 'reconcile', 'regen-index', 'row-flip', 's-append', 'session-start', 'vm-checks', 'x-refresh', 'z-write'])

function hasLedger(dir: string): boolean {
  return existsSync(join(dir, '.scratchpad', 'dossier'))
}

function gitLine(args: string[]): string | undefined {
  const done = spawnSync('git', args, { encoding: 'utf8', timeout: GIT_TIMEOUT_MS })
  return done.status === 0 ? done.stdout : undefined
}

function ledgerRoot(): string {
  const here = process.cwd()
  if (hasLedger(here)) return here
  const top = gitLine(['rev-parse', '--show-toplevel'])?.trim()
  if (top && hasLedger(top)) return top
  const primary = PRIMARY.exec(gitLine(['worktree', 'list', '--porcelain']) ?? '')?.[1]
  return primary && hasLedger(primary) ? primary : here
}

export async function main(args: string[]): Promise<number> {
  const [verb, ...rest] = args
  const ledger = ledgerRoot()
  claimRoots(ledger)
  if (verb === 'x-refresh' && rest[2] !== undefined) rest[2] = resolve(rest[2])
  if (verb !== undefined && LEDGER_VERBS.has(verb)) process.chdir(ledger)
  const run = verb === undefined ? undefined : VERBS[verb]
  if (!run) {
    console.error(`usage: ds <${Object.keys(VERBS).join('|')}> [args]`)
    return EXIT_USAGE
  }
  try {
    return await run(rest)
  } catch (error) {
    if (!(error instanceof Refusal)) throw error
    console.error(error.message)
    return error.code
  }
}
