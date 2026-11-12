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
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { constants, tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { convergenceStateVerb, convergeVerb, staleContracts } from './converge.ts'
import { closeVerb } from './close.ts'
import { claimRoots } from './env.ts'
import { milestoneOf, progressVerb } from './progress.ts'
import { io } from './stdio.ts'
import { resolvePinsVerb, verifyEditVerb, verifySweepVerb } from './verify.ts'
import { DATE_PREFIX } from '../engine/converge.ts'
import { delegationReport } from '../engine/delegation.ts'
import { addEntry, entryError, FRONTIER_CLOSED, openDecisions } from '../engine/grill.ts'
import { handoff } from '../engine/handoff.ts'
import { invariantVerdict, parseRegistry, rootRelative, skippedAdvisory } from '../engine/guards.ts'
import { addCarried, archivedCarried, isDue, LATER_FILE, laterRows, removeLater } from '../engine/later.ts'
import { migrate } from '../engine/migrate.ts'
import { firstWorktree, GIT_DIRS, linkedPrimary, WORKTREES } from '../engine/root.ts'
import { sessionReport } from '../engine/session.ts'
import { splitLines, strip } from '../engine/text.ts'
import { isVerdictAgent, structuredVerdicts, verdictLines } from '../engine/verdicts.ts'
import {
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
  openOps,
  statusSection,
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
  return [file, migrate(readFileSync(file, 'utf8'), stamp(new Date(), true)).text]
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

function sAppendTo(dir: string, event: string): string {
  const [file, text] = readDossier('s-append', dir)
  const entry = `${stamp(new Date(), true)} ${event}`
  atomicWrite(file, sAppend(text, entry))
  return entry
}

function sAppendVerb(args: string[]): number {
  const dir = required('s-append', args[0], 'ds s-append <dossier-dir> <event-text...>')
  const event = args.slice(1).join(' ')
  if (!event) refuse('s-append', 'empty event text')
  console.log(sAppendTo(dir, event))
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

function grillArtifact(root: string, slug: string): string | undefined {
  const dir = `${root}/dossier/.grill`
  let names: string[] = []
  try {
    names = readdirSync(dir)
  } catch {
    names = []
  }
  const matches = names.filter((name) => DATE_PREFIX.test(name) && name.slice(11) === `${slug}.md`).map((name) => `${dir}/${name}`)
  return matches.length ? matches.reduce((best, path) => (path > best ? path : best)) : undefined
}

function grillAddVerb(args: string[]): number {
  const [root = '', slug = '', entry = ''] = args
  if (args.length !== 3 || !/^[a-z0-9][a-z0-9-]{0,29}$/.test(slug))
    throw new Refusal('usage: ds grill-add <scratchpad-root> <slug> "<FACT:|DECISION:|FRONTIER:|CONFIRMED: entry>"', EXIT_USAGE)
  const error = entryError(entry)
  if (error) throw new Refusal(`ds grill-add: ${error}`, EXIT_USAGE)
  const existing = grillArtifact(root, slug)
  const grill = existing ?? `${root}/dossier/.grill/${new Date().toISOString().slice(0, 10)}-${slug}.md`
  const text = existing ? readFileSync(existing, 'utf8') : `# grill: ${slug}\n`
  if (/^CONSUMED: /m.test(text)) throw new Refusal(`grill artifact already consumed: ${grill} — start a fresh grill`, 4)
  mkdirSync(dirname(grill), { recursive: true })
  atomicWrite(grill, addEntry(text, entry))
  console.log(grill)
  return 0
}

function assertGrillVerb(args: string[]): number {
  const consume = args[0] === '--consume'
  const rest = consume ? args.slice(1) : args
  if (rest.length !== (consume ? 3 : 2)) {
    throw new Refusal('usage: ds assert-grill <scratchpad-root> <slug> | --consume <scratchpad-root> <slug> <dossier-dir-key>', EXIT_USAGE)
  }
  const [root = '', slug = '', key = ''] = rest
  const grill = grillArtifact(root, slug)
  if (grill === undefined) throw new Refusal(`grill artifact missing for slug ${slug}`)
  const rows = lines(readFileSync(grill, 'utf8'))
  const consumed = rows.find((row) => row.startsWith('CONSUMED: '))
  if (consumed !== undefined) {
    throw new Refusal(`grill artifact already consumed: ${grill} (${consumed}) — run ds:grill ${slug} for a fresh one`, 4)
  }
  const open = openDecisions(rows)
  if (open.length) throw new Refusal(`grill incomplete: open decision(s): ${open.join(', ')} in ${grill} (finish via ds:grill --resume)`, 2)
  if (!rows.some((row) => FRONTIER_CLOSED.test(row))) {
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

function lockHeld(dir: string): string | undefined {
  const path = `${dir}/.ds-lock`
  if (!isFile(path) || staleLocks(dir).some(([stale]) => stale === path)) return undefined
  try {
    const data: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const skill = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).skill : undefined
    return typeof skill === 'string' && skill ? skill : 'another op'
  } catch {
    return 'another op'
  }
}

function migrateVerb(args: string[]): number {
  const dir = required('migrate', args[0], 'ds migrate <dossier-dir>')
  const holder = lockHeld(dir)
  if (holder) refuse('migrate', `${dir} locked by ${holder} — rerun when it finishes`)
  const file = dossierFile(dir)
  if (!isFile(file)) refuse('migrate', `not found: ${file}`)
  const result = migrate(readFileSync(file, 'utf8'), stamp(new Date(), true))
  if (!result.applied.length) return 0
  atomicWrite(file, result.text)
  console.log(`migrated ${dir}: ${result.applied.join(', ')}`)
  return 0
}

function dsCloseVerb(args: string[]): number {
  return closeVerb(args, {
    write: (file, text) => atomicWrite(file, text),
    append: sAppendTo,
    setHeader,
    archiveMove,
    regenIndex,
    lockHeld,
    stamp: () => stamp(new Date()),
    cli: join(import.meta.dirname, 'ds'),
  })
}

function clearLocksVerb(args: string[]): number {
  const dryRun = args.includes('--dry-run')
  const dir = args.filter((arg) => arg !== '--dry-run').pop() || '.scratchpad/dossier'
  for (const line of clearLocks(dir, dryRun)) console.log(line)
  return 0
}

function safeMilestone(dir: string, root: string): string | undefined {
  try {
    return milestoneOf(dir, root)
  } catch {
    return undefined
  }
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
      quietly(() => sAppendTo(`${archive}/${name}`, 'ds:reconcile — auto-archived closed dossier (§Z-backed, was not under _archive)'))
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

function advisories(scratchpad: string): string[] {
  const archive = `${scratchpad}/dossier/_archive`
  const out: string[] = []
  for (const name of subdirs(archive).filter((entry) => isFile(`${archive}/${entry}/DOSSIER.md`))) {
    const text = readFileSync(`${archive}/${name}/DOSSIER.md`, 'utf8')
    if (openOps(statusSection(text)).has('ds:close —')) out.push(`advisory: ${name} close did not finish — \`ds close ${name}\` resumes it`)
    else if (!zClosed(text)) out.push(`advisory: ${name} is archived with no §Z closure key — \`ds close\` on it writes one`)
  }
  const root = resolve(scratchpad, '..')
  const own = resolve(process.env.DOSSIER_LEDGER_ROOT ?? '') === root
  for (const path of staleContracts(root, own ? process.env.PWD || root : root)) {
    out.push(`advisory: ${path} belongs to no open wave — move it to .dossier/_archive/`)
  }
  return out
}

function dsCheckVerb(args: string[]): number {
  const scratchpad = args[0] || '.scratchpad'
  regenIndex(scratchpad)
  const index = `${scratchpad}/INDEX.md`
  if (!isFile(index)) return 0
  const notes = advisories(scratchpad)
  if (notes.length) console.log(notes.join('\n'))
  const drift = /<!-- drift:([0-9]+) slugs:([^>]*) -->/.exec(readFileSync(index, 'utf8'))
  if (!drift) return 0
  console.error(`ds:check: Vm.1/Vm.4 DRIFT — ${drift[1]} dossier(s) with header/location/§Z disagreement: ${drift[2]}`)
  console.error('reconcile: session-start self-heals §Z-closed drift; otherwise finish the close (rerun ds close <wave>) or fix the header token.')
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

function existingRealPath(path: string): string {
  const rest: string[] = []
  let head = path
  for (;;) {
    try {
      return join(realpathSync.native(head), ...rest)
    } catch {
      const parent = dirname(head)
      if (parent === head) return path
      rest.unshift(basename(head))
      head = parent
    }
  }
}

function nearestDir(path: string): string {
  let dir = dirname(path)
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir)
  return dir
}

const REPO_PINS = new Set(['GIT_DIR', 'GIT_COMMON_DIR', 'GIT_WORK_TREE'])

function repoLine(dir: string, args: string[]): string | undefined {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !REPO_PINS.has(name)))
  const done = spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: GIT_TIMEOUT_MS, env })
  return done.status === 0 ? done.stdout : undefined
}

function commonDir(dir: string): string | undefined {
  const common = repoLine(dir, GIT_DIRS)?.trim().split('\n')[1]
  return common ? existingRealPath(common) : undefined
}

function guardCandidates(root: string, filePath: string): string[] | undefined {
  if (!isAbsolute(filePath)) return [filePath]
  const raw = resolve(filePath)
  const rawRoot = resolve(root)
  const real = existingRealPath(filePath)
  const inside: (string | undefined)[] = [rootRelative(raw, rawRoot), rootRelative(real, existingRealPath(rawRoot))]
  if (!inside.some((path) => path !== undefined)) {
    const near = nearestDir(real)
    const shared = commonDir(near)
    if (shared === undefined || shared !== commonDir(rawRoot)) return undefined
    const top = repoLine(near, ['rev-parse', '--show-toplevel'])?.trim()
    if (top) inside.push(rootRelative(raw, top), rootRelative(real, existingRealPath(top)))
  }
  const relative = inside.filter((path): path is string => path !== undefined)
  return relative.length ? [raw, real, ...relative] : undefined
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
    payload = JSON.parse(io.stdin())
  } catch {
    return 0
  }
  const { file_path: filePath, chunks } = (payload ?? {}) as { file_path?: unknown; chunks?: unknown }
  if (typeof filePath !== 'string' || !Array.isArray(chunks)) return 0
  const candidates = guardCandidates(root, filePath)
  if (candidates === undefined) return 0
  const verdict = invariantVerdict({ filePath, chunks: chunks.map(String) }, parseRegistry(registryText), candidates)
  if (verdict.deny) {
    console.log(verdict.deny)
    return 1
  }
  if (verdict.skipped.length) console.log(skippedAdvisory(verdict.skipped))
  return 0
}

function stdinPayload(): Record<string, unknown> {
  try {
    const payload: unknown = JSON.parse(io.stdin())
    return typeof payload === 'object' && payload !== null && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function text(value: unknown): string {
  return value ? String(value) : ''
}

function seedLater(dossiers: string): void {
  const list = `${dossiers}/${LATER_FILE}`
  if (isFile(list)) return
  const today = stamp(new Date()).slice(0, 10)
  const archive = `${dossiers}/_archive`
  const rows = subdirs(archive)
    .sort()
    .flatMap((name) => (isFile(`${archive}/${name}/DOSSIER.md`) ? archivedCarried(name, readFileSync(`${archive}/${name}/DOSSIER.md`, 'utf8'), today) : []))
  if (rows.length) atomicWrite(list, addCarried(undefined, rows).text)
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
  quietly(() => seedLater(dossiers))
  const index = `${scratchpad}/INDEX.md`
  const ledgers = subdirs(dossiers)
    .filter((name) => name !== '_archive' && isFile(`${dossiers}/${name}/DOSSIER.md`))
    .map((name) => ({
      name,
      text: readFileSync(`${dossiers}/${name}/DOSSIER.md`, 'utf8'),
      milestone: safeMilestone(`${dossiers}/${name}`, resolve(scratchpad, '..')),
    }))
  let notes: string[] = []
  quietly(() => {
    notes = advisories(scratchpad)
  })
  const report = sessionReport({
    index: isFile(index) ? readFileSync(index, 'utf8') : undefined,
    ledgers,
    source: text(payload.source),
    title: text(payload.session_title),
    titleFlag: process.env.DOSSIER_SESSION_TITLE ?? '0',
    nudgeFlag: process.env.DOSSIER_LIVE_NUDGE ?? '1',
    notes,
    later: isFile(laterFile()) ? readFileSync(laterFile(), 'utf8') : undefined,
    today: stamp(new Date()).slice(0, 10),
  })
  const specific = { hookEventName: 'SessionStart', additionalContext: report.context, ...(report.title ? { sessionTitle: report.title } : {}) }
  console.log(JSON.stringify({ continue: true, hookSpecificOutput: specific, ...(report.system ? { systemMessage: report.system } : {}) }))
  return 0
}

function scratchpadEntry(entry: string): boolean {
  let path = entry.length > 3 ? entry.slice(3).trim() : ''
  if (path.includes(' -> ')) path = path.slice(path.lastIndexOf(' -> ') + 4)
  return path
    .trim()
    .replace(/^"+|"+$/g, '')
    .split('/')
    .includes('.scratchpad')
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

function verdictLogVerb(args: string[]): number {
  const [root] = args
  if (root === undefined) throw new Refusal('usage: ds verdict-log <project-root> < {"agent_type", "agent_id", "last_assistant_message"}', EXIT_USAGE)
  const dossiers = join(root, '.scratchpad', 'dossier')
  const stop = stdinPayload()
  if (!isDir(dossiers) || !isVerdictAgent(stop.agent_type)) return 0
  const record = {
    ts: new Date().toISOString(),
    agent_type: stop.agent_type,
    agent_id: typeof stop.agent_id === 'string' ? stop.agent_id : null,
    verdicts: stopVerdicts(stop),
  }
  appendFileSync(join(dossiers, '.verdicts.jsonl'), `${JSON.stringify(record)}\n`)
  return 0
}

function stopVerdicts(stop: Record<string, unknown>): string[] | null {
  const message = stop.last_assistant_message
  if (typeof message === 'string') return verdictLines(message, stop.agent_type)
  return transcriptVerdicts(stop.agent_transcript_path)
}

function isStructuredOutput(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const { type, name } = block as Record<string, unknown>
  return type === 'tool_use' && name === 'StructuredOutput'
}

function transcriptVerdicts(path: unknown): string[] | null {
  if (typeof path !== 'string') return null
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return null
  }
  const calls = splitLines(text).flatMap((line) => {
    try {
      const entry = JSON.parse(line) as { message?: { content?: unknown } }
      const content = entry.message?.content
      return Array.isArray(content) ? content.filter(isStructuredOutput) : []
    } catch {
      return []
    }
  })
  const last = calls.at(-1) as { input?: unknown } | undefined
  return last === undefined ? null : structuredVerdicts(last.input)
}

function delegationCheckVerb(args: string[]): number {
  const [dir] = args
  const file = dir === undefined ? '' : dossierFile(dir)
  const missing = file ? ` (not found: ${file})` : ''
  const usage = `usage: ds delegation-check <dossier-dir>${missing}`
  if (!isFile(file)) refuse('delegation-check', usage, EXIT_USAGE)
  const { failures, delegated } = delegationReport(readFileSync(file, 'utf8'))
  for (const line of failures) console.log(line)
  const verdict = failures.length ? `FAIL ${failures.length}` : `CLEAN ${delegated} delegated rows`
  console.log(`DELEGATION: ${verdict}`)
  return failures.length ? 1 : 0
}

function handoffVerb(args: string[]): number {
  const [dir] = args
  if (!dir) {
    console.error('usage: ds handoff <dossier-dir>')
    return EXIT_USAGE
  }
  const file = join(dir, 'DOSSIER.md')
  if (!existsSync(file)) {
    console.error(`ds handoff: not found: ${file}`)
    return 1
  }
  const slug = basename(resolve(dir)).replace(DATE_PREFIX, '')
  console.log(handoff(readFileSync(file, 'utf8'), slug, stamp(new Date(), true)).join('\n'))
  return 0
}

function laterFile(): string {
  return join(process.env.DOSSIER_LEDGER_ROOT || process.cwd(), '.scratchpad', 'dossier', LATER_FILE)
}

function laterVerb(args: string[]): number {
  const [action, key, ...extra] = args
  const file = laterFile()
  const text = isFile(file) ? readFileSync(file, 'utf8') : undefined
  const today = stamp(new Date()).slice(0, 10)
  if (action === undefined) {
    const rows = laterRows(text)
    for (const row of rows) console.log(`${row.key} · ${row.task} · ${row.who}${row.due ? ` · due ${row.due}` : ''}${isDue(row, today) ? ' — due now' : ''}`)
    if (!rows.length) console.log('later: none')
    return 0
  }
  if (!['done', 'drop'].includes(action) || key === undefined || extra.length) refuse('later', 'usage: ds later [done|drop <wave>/T<n>]', EXIT_USAGE)
  const left = removeLater(text, key)
  if (left === undefined) refuse('later', `no carried row ${key} in ${file}`)
  atomicWrite(file, left)
  console.log(`later: ${key} removed (${action})`)
  return 0
}

const VERBS: Record<string, (args: string[]) => number | Promise<number>> = {
  'archive-move': archiveMoveVerb,
  'assert-grill': assertGrillVerb,
  'assert-scaffold': assertScaffoldVerb,
  migrate: migrateVerb,
  'clear-locks': clearLocksVerb,
  close: dsCloseVerb,
  converge: (args: string[]) => convergeVerb(args, sAppendTo),
  'convergence-state': convergenceStateVerb,
  'delegation-check': delegationCheckVerb,
  'ds-check': dsCheckVerb,
  fakeimpl: fakeimplVerb,
  'grill-add': grillAddVerb,
  handoff: handoffVerb,
  'header-state': headerStateVerb,
  'invariant-check': invariantCheckVerb,
  later: laterVerb,
  progress: progressVerb,
  reconcile: reconcileVerb,
  root: rootVerb,
  'resolve-pins': resolvePinsVerb,
  'regen-index': regenIndexVerb,
  'row-flip': rowFlipVerb,
  'session-start': sessionStartVerb,
  's-append': sAppendVerb,
  'verdict-log': verdictLogVerb,
  'verify-edit': verifyEditVerb,
  'verify-sweep': verifySweepVerb,
  'vm-checks': vmChecksVerb,
  'x-refresh': xRefreshVerb,
  'z-write': zWriteVerb,
}

const GIT_TIMEOUT_MS = 5000
const LEDGER_VERBS = new Set([
  'archive-move',
  'assert-grill',
  'assert-scaffold',
  'clear-locks',
  'ds-check',
  'grill-add',
  'header-state',
  'migrate',
  'reconcile',
  'regen-index',
  'row-flip',
  's-append',
  'session-start',
  'vm-checks',
  'x-refresh',
  'z-write',
])

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
  const worktrees = gitLine(WORKTREES)
  const gitDirs = gitLine(GIT_DIRS)
  const first = firstWorktree(worktrees, gitDirs)
  if (first && hasLedger(first)) return first
  return linkedPrimary(gitDirs, worktrees) ?? top ?? here
}

function rootVerb(): number {
  console.log(ledgerRoot())
  return 0
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
