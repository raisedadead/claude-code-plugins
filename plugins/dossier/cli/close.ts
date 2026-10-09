import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { DATE_PREFIX } from '../engine/converge.ts'
import { headerToken, lines, namedRows, openOps, SEC, statusSection, unlines, unpushedRepos, zClosed, zColumn, zWrite } from '../engine/ledger.ts'
import { migrate } from '../engine/migrate.ts'
import { DELAYED, type Row, taskRows } from '../engine/progress.ts'
import { childEnv } from './env.ts'
import { topLevel, waveContract } from './converge.ts'

export type CloseTools = {
  write: (file: string, text: string) => void
  append: (dir: string, event: string) => void
  setHeader: (dir: string, state: string) => void
  archiveMove: (source: string, parent: string) => void
  regenIndex: (scratchpad: string) => void
  lockHeld: (dir: string) => string | undefined
  stamp: () => string
  cli: string
}

type Mode = { kind: 'complete' | 'successor' | 'abandoned'; flag: string; value: string }

type Options = {
  target: string
  mode: Mode
  plan: boolean
  carry: string[]
  acceptUnmet: boolean
  summary: string
  cites: string
}

const USAGE =
  'usage: ds close <wave> (--complete | --successor <slug> | --abandon <reason>) [--plan] [--carry T<n>,...] [--accept-unmet] [--summary <text>] [--cites <text>]'
const EXIT_USAGE = 64
const EMPTY: readonly string[] = ['', '—', '-']

class Stop extends Error {
  readonly code: number

  constructor(message: string, code: number) {
    super(message)
    this.code = code
  }
}

function parse(args: string[]): Options {
  const modes: Mode[] = []
  const options: Omit<Options, 'mode'> = { target: '', plan: false, carry: [], acceptUnmet: false, summary: '', cites: '' }
  const value = (at: number, flag: string): string => {
    const next = args[at + 1]
    if (next === undefined || next.startsWith('--')) throw new Stop(`ds close: ${flag} needs a value — ${USAGE}`, EXIT_USAGE)
    return next
  }
  for (let at = 0; at < args.length; at++) {
    const arg = args[at] ?? ''
    if (arg === '--complete') modes.push({ kind: 'complete', flag: arg, value: '—' })
    else if (arg === '--successor') modes.push({ kind: 'successor', flag: arg, value: value(at++, arg) })
    else if (arg === '--abandon') modes.push({ kind: 'abandoned', flag: arg, value: value(at++, arg) })
    else if (arg === '--plan') options.plan = true
    else if (arg === '--accept-unmet') options.acceptUnmet = true
    else if (arg === '--carry')
      options.carry = value(at++, arg)
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean)
    else if (arg === '--summary') options.summary = value(at++, arg)
    else if (arg === '--cites') options.cites = value(at++, arg)
    else if (!arg.startsWith('--') && !options.target) options.target = arg
    else throw new Stop(`ds close: unknown argument ${arg} — ${USAGE}`, EXIT_USAGE)
  }
  const [mode] = modes
  if (!options.target || modes.length !== 1 || mode === undefined) throw new Stop(`ds close: ${USAGE}`, EXIT_USAGE)
  return { ...options, mode }
}

function dirs(parent: string): string[] {
  try {
    return readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== '_archive')
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

function matches(name: string, target: string): boolean {
  return name === target || name.replace(DATE_PREFIX, '') === target
}

function locate(dossiers: string, target: string): { dir: string; archived: boolean } | undefined {
  const name = basename(target)
  const live = dirs(dossiers).filter((entry) => matches(entry, name))
  if (live.length) return { dir: join(dossiers, live[live.length - 1] ?? ''), archived: false }
  const old = dirs(join(dossiers, '_archive')).filter((entry) => matches(entry, name))
  if (old.length) return { dir: join(dossiers, '_archive', old[old.length - 1] ?? ''), archived: true }
  return undefined
}

function git(repo: string, ...args: string[]): { ok: boolean; out: string; err: string } {
  const done = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  return { ok: done.status === 0, out: (done.stdout ?? '').trim(), err: (done.stderr ?? '').trim() }
}

function bugsOpen(text: string): string[] {
  return namedRows(text, SEC.bugs)
    .filter((row) => /^B\d+$/.test(row('id')) && EMPTY.includes(row('fix cite')))
    .map((row) => row('id'))
}

function carriable(row: Row): boolean {
  return row.who === 'H' || row.needs.some((need) => DELAYED.test(need))
}

function carryNote(row: Row): string {
  const delay = row.needs.find((need) => DELAYED.test(need))
  return `${row.id} ${row.task} (${delay ?? row.who})`
}

type Verdict = { line: string; record: string; blocks: boolean }

function converge(tools: CloseTools, contract: string | undefined, accept: boolean): Verdict {
  if (contract === undefined) return { line: '· converge: no contract', record: 'absent', blocks: false }
  const done = spawnSync('sh', [tools.cli, 'converge', contract], { encoding: 'utf8', env: childEnv({}) })
  const out = done.stdout ?? ''
  const met = /CONVERGE: MET (\d+\/\d+)/.exec(out)
  if (met) return { line: `✓ converge ${met[1]}`, record: `met:${met[1]}`, blocks: false }
  if (/CONVERGE: UNMET/.test(out)) {
    const ids = [...out.matchAll(/^ {2}UNMET (\S+)\./gm)].map((match) => match[1]).join(',')
    if (accept) return { line: `⚠ converge unmet ${ids} — accepted`, record: `unmet:${ids} accepted`, blocks: false }
    return { line: `✗ converge unmet ${ids} — fix them, or --accept-unmet on the operator's say-so`, record: '', blocks: true }
  }
  const why = /CONVERGE: PARSE — (.*)/.exec(out)?.[1] ?? 'no verdict'
  if (accept) return { line: `⚠ converge did not run: ${why} — accepted`, record: 'parse accepted', blocks: false }
  return { line: `✗ converge did not run: ${why} — fix the contract, or --accept-unmet on the operator's say-so`, record: '', blocks: true }
}

function successorDir(dossiers: string, slug: string): string | undefined {
  const found = dirs(dossiers).filter((entry) => matches(entry, slug))
  return found.length ? join(dossiers, found[found.length - 1] ?? '') : undefined
}

function carryInto(tools: CloseTools, target: string, slug: string, rows: Row[]): string[] {
  const file = join(target, 'DOSSIER.md')
  const text = migrate(readFileSync(file, 'utf8'), tools.stamp()).text
  const present = (row: Row): boolean => [')', ','].some((end) => text.includes(`(from ${slug} ${row.id}${end}`))
  const fresh = rows.filter((row) => !present(row))
  if (!fresh.length) return []
  const all = lines(text)
  const ids = taskRows(text).map((row) => Number(row.id.slice(1)))
  let next = Math.max(0, ...ids)
  let last = -1
  let inside = false
  all.forEach((row, at) => {
    if (SEC.any.test(row)) inside = SEC.tasks.test(row)
    else if (inside && row.startsWith('|')) last = at
  })
  if (last < 0) throw new Stop(`ds close: successor ${basename(target)} has no Tasks table`, 1)
  const added = fresh.map((row) => {
    next++
    const delay = row.needs.find((need) => DELAYED.test(need))
    const origin = delay ? `(from ${slug} ${row.id}, after ${slug} ${delay})` : `(from ${slug} ${row.id})`
    return { id: `T${next}`, line: `| T${next} | . | ${row.who} | ${row.task} ${origin} | — | — | ${row.verify || '—'} |` }
  })
  all.splice(last + 1, 0, ...added.map((row) => row.line))
  tools.write(file, unlines(all))
  return fresh.map((row, at) => `${row.id}→${added[at]?.id ?? ''}`)
}

function retire(slug: string, dir: string, root: string): string | undefined {
  const stems = [basename(dir), basename(dir).replace(DATE_PREFIX, '')]
  const contract = waveContract(dir, root)
  const tops = contract && !contract.endsWith('/CONTRACT.md') ? [dirname(dirname(contract))] : [...new Set([topLevel(process.cwd()), root])]
  for (const top of tops) {
    const sha = retireIn(top, stems, dir, slug)
    if (sha) return sha
  }
  return undefined
}

function retireIn(top: string, stems: string[], dir: string, slug: string): string | undefined {
  for (const stem of stems) {
    const old = `.dossier/${stem}.md`
    const moved = `.dossier/_archive/${stem}.md`
    if (git(top, 'ls-files', '--error-unmatch', old).ok && existsSync(join(top, old))) {
      if (existsSync(join(top, '.git', 'MERGE_HEAD')) || git(top, 'rev-parse', '-q', '--verify', 'MERGE_HEAD').ok) {
        throw new Stop(`ds close: ${top} has a merge in progress — finish it, then rerun`, 1)
      }
      mkdirSync(join(top, '.dossier', '_archive'), { recursive: true })
      const mv = git(top, 'mv', old, moved)
      if (!mv.ok) throw new Stop(`ds close: git mv ${old} failed: ${mv.err}`, 1)
    }
    const staged = git(top, 'diff', '--cached', '--name-only', '--', old, moved).out
    if (!staged) continue
    const commit = git(top, 'commit', '-q', '-m', `chore(dossier): archive wave contract ${basename(dir)}`, '--', old, moved)
    if (!commit.ok) throw new Stop(`ds close: the contract move is staged but the commit failed — fix it, then rerun ds close ${slug}\n${commit.err}`, 1)
    return git(top, 'rev-parse', '--short', 'HEAD').out
  }
  return undefined
}

function render(header: string, findings: string[], ready: boolean): string {
  return [header, ...findings.map((line) => `  ${line}`), ready ? 'ready' : 'refused'].join('\n')
}

export function closeVerb(args: string[], tools: CloseTools): number {
  try {
    return close(parse(args), tools)
  } catch (error) {
    if (!(error instanceof Stop)) throw error
    console.error(error.message)
    return error.code
  }
}

type Wave = { root: string; scratchpad: string; dossiers: string; dir: string; archived: boolean; slug: string }

type Check = { findings: string[]; blocked: boolean; record: string }

function wave(target: string): Wave {
  const root = process.env.DOSSIER_LEDGER_ROOT || process.cwd()
  const scratchpad = join(root, '.scratchpad')
  const dossiers = join(scratchpad, 'dossier')
  const found = locate(dossiers, target)
  if (!found) throw new Stop(`ds close: no wave named ${target} under ${relative(process.cwd(), dossiers) || dossiers}`, 1)
  return { root, scratchpad, dossiers, ...found, slug: basename(found.dir).replace(DATE_PREFIX, '') }
}

function takeLock(dir: string): void {
  writeFileSync(join(dir, '.ds-lock'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), skill: 'ds close', target: '—' }))
}

function changelogAdvisory(contract: string | undefined): string | undefined {
  if (!contract || contract.endsWith('/CONTRACT.md')) return 'no tracked contract — the CHANGELOG.md check did not run'
  const top = dirname(dirname(contract))
  const added = git(top, 'log', '--diff-filter=A', '--format=%H', '--', relative(top, contract)).out.split('\n').pop()
  if (!added) return 'the contract is not committed — the CHANGELOG.md check did not run'
  const tracked = git(top, 'diff', '--name-only', added).out.split('\n')
  const changed = [...tracked, ...git(top, 'ls-files', '--others', '--exclude-standard').out.split('\n')]
  if (changed.some((path) => basename(path) === 'CHANGELOG.md')) return undefined
  return 'no CHANGELOG.md changed since the contract commit — write the entry first, or close without one'
}

function check(options: Options, tools: CloseTools, at: Wave, text: string, rows: Row[]): Check {
  const { mode } = options
  const result: Check = { findings: [], blocked: false, record: 'skipped' }
  const fail = (line: string): void => {
    result.findings.push(`✗ ${line}`)
    result.blocked = true
  }
  const holder = tools.lockHeld(at.dir)
  if (holder) fail(`locked by ${holder} — wait for it or let it finish`)
  if (zClosed(text)) return result
  for (const id of options.carry) {
    const row = rows.find((candidate) => candidate.id === id)
    if (!row || row.state === 'x' || !carriable(row)) fail(`${id} cannot carry — only an open H row or a row with a +Nd need carries`)
  }
  if (mode.kind !== 'abandoned') {
    const open = rows.filter((row) => row.state !== 'x' && !options.carry.includes(row.id))
    if (open.length) fail(`${open.map((row) => row.id).join(' ')} open — finish them, --carry them, or --abandon`)
    const uncited = rows.filter((row) => row.state === 'x' && EMPTY.includes(row.cite))
    if (uncited.length) fail(`${uncited.map((row) => row.id).join(' ')} done with no cite`)
    for (const id of bugsOpen(text)) fail(`${id} has no fix cite — ds:backprop ${id}, or --abandon`)
  }
  const carried = rows.filter((row) => options.carry.includes(row.id))
  if (mode.kind === 'successor') {
    const next = successorDir(at.dossiers, mode.value)
    const busy = next && carried.length ? tools.lockHeld(next) : undefined
    if (!next) fail(`successor ${mode.value} not found — ds:new ${mode.value} first`)
    else if (busy) fail(`successor ${mode.value} locked by ${busy} — wait for it, then rerun`)
  }
  if (carried.length) result.findings.push(`↷ carry ${carried.map((row) => carryNote(row).replace(` ${row.task} `, ' ')).join(', ')}`)
  if (!holder && mode.kind !== 'abandoned') {
    const verdict = converge(tools, waveContract(at.dir, at.root), options.acceptUnmet)
    result.findings.push(verdict.line)
    if (verdict.blocks) result.blocked = true
    result.record = verdict.record
  }
  for (const repo of unpushedRepos(text)) result.findings.push(`⚠ ${repo} not pushed — the push stays yours`)
  const changelog = mode.kind === 'abandoned' ? undefined : changelogAdvisory(waveContract(at.dir, at.root))
  if (changelog) result.findings.push(`⚠ ${changelog}`)
  return result
}

function run(options: Options, tools: CloseTools, at: Wave, rows: Row[], record: string): string {
  const { mode } = options
  let dir = at.dir
  const file = (): string => join(dir, 'DOSSIER.md')
  const status = statusSection(readFileSync(file(), 'utf8'))
  takeLock(dir)
  try {
    if (!zClosed(readFileSync(file(), 'utf8'))) {
      if (!openOps(status).has('ds:close —')) {
        tools.append(dir, `ds:close — START mode=${mode.kind} carry=${options.carry.join(',') || '—'} converge=${record}`)
      }
      const carried = rows.filter((row) => options.carry.includes(row.id))
      if (mode.kind === 'successor' && carried.length) {
        const target = successorDir(at.dossiers, mode.value)
        const moved = target ? carryInto(tools, target, at.slug, carried) : []
        if (moved.length) tools.append(dir, `ds:close — carried=${moved.join(',')} into ${mode.value}`)
      }
      const cites =
        options.cites ||
        rows
          .filter((row) => row.state === 'x')
          .map((row) => row.cite)
          .join(', ') ||
        '—'
      const result = zWrite(
        readFileSync(file(), 'utf8'),
        file(),
        mode.kind,
        mode.value,
        options.summary,
        cites,
        tools.stamp(),
        carried.map(carryNote).join('; '),
      )
      if ('error' in result) throw new Stop(`ds close: ${result.error}`, 1)
      tools.write(file(), result.text)
    }
    if (headerToken(readFileSync(file(), 'utf8')) !== 'done') {
      tools.setHeader(dir, 'done')
      tools.append(dir, 'ds:close — §Z=written')
    }
    if (!at.archived) {
      rmSync(join(dir, '.ds-lock'), { force: true })
      tools.archiveMove(dir, join(at.dossiers, '_archive'))
      dir = join(at.dossiers, '_archive', basename(dir))
      takeLock(dir)
      tools.append(dir, 'ds:close — archived')
    }
    const sha = retire(at.slug, dir, at.root)
    if (sha) tools.append(dir, `ds:close — contract=${sha}`)
    tools.regenIndex(at.scratchpad)
    const final = readFileSync(file(), 'utf8')
    if (openOps(statusSection(final)).has('ds:close —') || !/ds:close — DONE/.test(final)) {
      tools.append(dir, 'ds:close — DONE')
    }
  } finally {
    rmSync(join(dir, '.ds-lock'), { force: true })
  }
  return dir
}

function report(at: Wave, dir: string): string {
  const closed = readFileSync(join(dir, 'DOSSIER.md'), 'utf8')
  const kind = zColumn(closed)
  const after = /^after: (.*)$/m.exec(closed)?.[1]
  return [`ds close ${at.slug} → done`, `  §Z: ${kind}`, `  archived: ${relative(at.root, dir)}`, ...(after ? [`  after: ${after}`] : [])].join('\n')
}

function close(options: Options, tools: CloseTools): number {
  const at = wave(options.target)
  const text = readFileSync(join(at.dir, 'DOSSIER.md'), 'utf8')
  const { mode } = options
  const status = statusSection(text)
  const started = status.filter((line) => /ds:close — START/.test(line)).pop()
  if (started && !new RegExp(`mode=${mode.kind}\\b`).test(started) && openOps(status).has('ds:close —')) {
    throw new Stop(`ds close: an unfinished close started with another mode — ${started}`, 1)
  }
  const sealed = zClosed(text)
  if (!sealed && !options.plan && !options.summary) throw new Stop(`ds close: --summary is required to write §Z — ${USAGE}`, EXIT_USAGE)
  const rows = taskRows(text)
  const verdict = check(options, tools, at, text, rows)
  const steps = [!sealed && 'closeout', !at.archived && 'archive', 'contract', 'index'].filter(Boolean).join(' → ')
  verdict.findings.push(`steps: ${steps}`)
  if (options.plan || verdict.blocked) {
    const header = `ds close ${at.slug} ${mode.flag}${mode.kind === 'complete' ? '' : ` ${mode.value}`}`
    console.log(render(header, verdict.findings, !verdict.blocked))
    return verdict.blocked ? 1 : 0
  }
  console.log(report(at, run(options, tools, at, rows, verdict.record)))
  return 0
}
