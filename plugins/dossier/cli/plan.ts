import { existsSync, readdirSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { defaultBase, globMatch } from '../engine/branch.ts'
import { appendRow, type Check, checks, commits, header, lint, planHash, rows, section, setHeader, setRow, template } from '../engine/plan.ts'
import { formatRow, type Row, type State, STATES, scanRows, shapeErrors, type Who } from '../engine/rows.ts'
import { git, lines, Refusal, run } from '../engine/sh.ts'
import {
  type Dossier,
  dossierHome,
  ledgerRoot,
  liveDossiers,
  log,
  now,
  read,
  readOr,
  REGISTER_HEAD,
  registerFile,
  resolveDossier,
  takeId,
  today,
  workTree,
  worklog,
  write,
} from '../engine/store.ts'
import { render, renderStart, triage, writeLaterView } from '../engine/triage.ts'

export type Args = { _: string[]; flags: Record<string, string | true> }
export const flag = (args: Args, name: string): string | undefined => {
  const value = args.flags[name]
  return typeof value === 'string' ? value : undefined
}
export const dossierOf = (cwd: string, args: Args): Dossier => resolveDossier(cwd, flag(args, 'dossier'))

export function cmdNew(cwd: string, args: Args): string {
  const slug = args._[0] ?? ''
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(slug)) throw new Refusal('usage: ds new <slug> (lower case, digits and dashes, up to 40 characters)', 2)
  const root = ledgerRoot(cwd)
  const taken = existsSync(dossierHome(root)) ? readdirSync(dossierHome(root)) : []
  let name = `${today()}-${slug}`
  for (let n = 2; taken.includes(name); n += 1) name = `${today()}-${slug}-${n}`
  const dir = join(dossierHome(root), name)
  const branch = flag(args, 'branch') ?? slug
  const id = takeId(root)
  write(join(dir, 'DOSSIER.md'), template(slug, branch, flag(args, 'base') ?? defaultBase(cwd), id))
  write(
    registerFile(root),
    appendRow(readOr(registerFile(root), REGISTER_HEAD), formatRow({ id, state: 'next', who: 'A', title: `dossier ${name}`, tail: '' })),
  )
  const dossier = { dir, name, slug, file: join(dir, 'DOSSIER.md') }
  log(dossier, `new ${slug} branch ${branch} row ${id}`)
  return `${dossier.file}`
}

function rowFiles(root: string): string[] {
  return [registerFile(root), ...liveDossiers(root).map((d) => d.file)].filter((file) => existsSync(file))
}

function findRow(root: string, id: string): { file: string; row: Row } {
  for (const file of rowFiles(root)) {
    const found = scanRows(read(file)).rows.find((row) => row.id === id)
    if (found) return { file, row: found }
  }
  throw new Refusal(`no row ${id} in OPEN-WORK.md or a live dossier`)
}

function checked(row: Row): Row {
  const errors = shapeErrors(row)
  if (errors.length) throw new Refusal(`${formatRow(row)}\n${errors.join('\n')}`)
  return row
}

function logFor(root: string, file: string, line: string): void {
  const dossier = liveDossiers(root).find((d) => d.file === file)
  if (dossier) log(dossier, line)
}

export function ownLine(root: string, dossier: Dossier): Row | undefined {
  const own = header(read(dossier.file)).row
  if (!own) return undefined
  return rows(readOr(registerFile(root), REGISTER_HEAD)).rows.find((r) => r.id === own)
}

export function guard(cwd: string, dossier: Dossier): void {
  const line = ownLine(ledgerRoot(cwd), dossier)
  if (!line || line.state === 'now' || line.state === 'next') return
  throw new Refusal(
    `${dossier.slug} waits on the operator: its line ${line.id} is ${line.state}${line.tail ? ` (${line.tail})` : ''}. The operator resumes it with: ds set ${line.id} next --who A`,
    3,
  )
}

export function startLine(cwd: string, dossier: Dossier, verb: string): void {
  const root = ledgerRoot(cwd)
  const line = ownLine(root, dossier)
  if (!line || line.state !== 'next') return
  const register = readOr(registerFile(root), REGISTER_HEAD)
  write(registerFile(root), setRow(register, line, formatRow({ ...line, state: 'now' })))
  log(dossier, `${verb} ${line.id} next->now`)
}

export function cmdAdd(cwd: string, args: Args): string {
  const title = args._.join(' ').trim()
  if (!title || /^<[^>]*>$/.test(title)) throw new Refusal('ds add needs a title: ds add "<title>" [--who A|H] [--state s] [--tail t] [--register]', 2)
  const root = ledgerRoot(cwd)
  const state = (flag(args, 'state') ?? 'next') as State
  if (!STATES.includes(state)) throw new Refusal(`state must be one of ${STATES.join(', ')}`, 2)
  const who = (flag(args, 'who') ?? 'A') as Who
  if (who !== 'A' && who !== 'H') throw new Refusal('who must be A or H', 2)
  const file = args.flags.register ? registerFile(root) : dossierOf(cwd, args).file
  const draft = checked({ id: 'O0', state, who, title, tail: flag(args, 'tail') ?? '' })
  const row = { ...draft, id: takeId(root) }
  const before = args.flags.register ? readOr(file, REGISTER_HEAD) : read(file)
  write(file, appendRow(before, formatRow(row)))
  logFor(root, file, `add ${formatRow(row).slice(2)}`)
  return formatRow(row)
}

export function setState(root: string, id: string, state: State, tail?: string, who?: string): string {
  if (!STATES.includes(state)) throw new Refusal(`state must be one of ${STATES.join(', ')}`, 2)
  if (who !== undefined && who !== 'A' && who !== 'H') throw new Refusal('who must be A or H', 2)
  const { file, row } = findRow(root, id)
  const next = checked({ ...row, state, who: (who as Who | undefined) ?? row.who, tail: tail ?? (state === row.state ? row.tail : '') })
  write(file, setRow(read(file), row, formatRow(next)))
  logFor(root, file, `set ${formatRow(next).slice(2)}`)
  return formatRow(next)
}

export function cmdSet(cwd: string, args: Args): string {
  const [id = '', state = '', ...tail] = args._
  if (!/^O\d+$/.test(id)) throw new Refusal('usage: ds set <O-id> <state> [tail]', 2)
  return setState(ledgerRoot(cwd), id, state as State, tail.length ? tail.join(' ') : undefined, flag(args, 'who'))
}

export function cmdLog(cwd: string, args: Args): string {
  const note = args._.join(' ').trim()
  if (!note) throw new Refusal('usage: ds log "<note>"', 2)
  log(dossierOf(cwd, args), `note ${note}`)
  return 'logged'
}

export function cmdLint(cwd: string, args: Args): string {
  const errors = lint(read(dossierOf(cwd, args).file))
  if (errors.length) throw new Refusal(`LINT: ${errors.length} problems\n${errors.join('\n')}`)
  return 'LINT: OK'
}

export function runChecks(
  cwd: string,
  dossier: Dossier,
  baseline: boolean,
  only?: (c: ReturnType<typeof checks>['checks'][number]) => boolean,
): { ok: boolean; text: string } {
  const found = checks(read(dossier.file))
  if (found.errors.length) throw new Refusal(found.errors.join('\n'))
  const done = new Set(
    rowsOf(dossier)
      .filter((r) => r.state === 'done')
      .map((r) => r.id),
  )
  const tree = workTree(cwd)
  const out: string[] = []
  let ok = true
  for (const check of found.checks.filter(only ?? (() => true))) {
    const ran = run(['bash', '-c', check.command], tree, { timeoutMs: 600_000 })
    const passed = ran.code === check.expect
    const built = check.rows.length > 0 && check.rows.every((id) => done.has(id))
    const stays = check.guard || built
    const onTree = baseline && !stays ? !passed : passed
    const want = baseline && !stays ? `anything but exit ${check.expect}` : `exit ${check.expect}`
    const sample = baseline && !built ? sampleRun(dossier, check) : undefined
    const good = onTree && (sample?.good ?? true)
    if (!good) ok = false
    out.push(`${good ? 'OK' : 'FAIL'} ${check.name}${check.guard ? ' (guard)' : built ? ' (built)' : ''}: exit ${ran.code}, want ${want}${sample?.note ?? ''}`)
    const shown = onTree ? (sample?.tail ?? '') : `${ran.out}${ran.err}`
    const tail = shown.trim().split('\n').slice(-5).join('\n')
    if (!good && tail) out.push(tail.replace(/^/gm, '  '))
  }
  return { ok, text: out.join('\n') }
}

type Sample = { good: boolean; note: string; tail: string }

function sampleRun(dossier: Dossier, check: Check): Sample {
  const dir = join(dossier.dir, 'samples', check.name)
  if (!/^[\w-][\w.-]*$/.test(check.name) || !existsSync(dir)) return { good: true, note: '; no sample', tail: '' }
  const ran = run(['bash', '-c', check.command], dir, { timeoutMs: 600_000, env: { GIT_CEILING_DIRECTORIES: dirname(dir) } })
  const passed = ran.code === check.expect
  const want = check.guard ? `anything but exit ${check.expect}` : `exit ${check.expect}`
  return { good: check.guard ? !passed : passed, note: `; sample: exit ${ran.code}, want ${want}`, tail: `${ran.out}${ran.err}` }
}

export function cmdCheck(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const baseline = Boolean(args.flags.baseline)
  const result = runChecks(cwd, dossier, baseline)
  const label = baseline ? 'BASELINE' : 'CHECK'
  const text = `${result.text}\n${label}: ${result.ok ? 'OK' : 'FAIL'}`
  write(join(dossier.dir, baseline ? 'baseline.txt' : 'check.txt'), text)
  log(dossier, `check${baseline ? ' --baseline' : ''} ${result.ok ? 'OK' : 'FAIL'} ${planHash(read(dossier.file))}`)
  if (!result.ok) throw new Refusal(text)
  return text
}

const CITE = /(?<![\w/.-])((?:[\w.-]+\/)*[\w.-]+\.\w+):(\d+)(?:-(\d+))?/g

export function cmdPackPlan(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const text = read(dossier.file)
  const hash = planHash(text)
  if (!worklog(dossier).some((line) => line.endsWith(`check --baseline OK ${hash}`))) throw new Refusal('run ds check --baseline on this plan first')
  const tree = workTree(cwd)
  const cited: string[] = []
  for (const [, path = '', from = '', to] of text.matchAll(CITE)) {
    const file = join(tree, path)
    if (!existsSync(file)) {
      cited.push(`### ${path}:${from}\n\n(no such file)`)
      continue
    }
    const all = read(file).split('\n')
    const start = Number(from)
    const end = Number(to ?? from)
    cited.push(`### ${path}:${from}${to ? `-${to}` : ''}\n\n\`\`\`\n${all.slice(start - 1, end).join('\n')}\n\`\`\``)
  }
  const patterns = commits(text).flatMap((c) => c.paths)
  const files = lines(git(tree, 'ls-files')).filter((path) => patterns.some((p) => globMatch(p, path)))
  const pack = [
    `# Plan check pack: ${dossier.slug}`,
    '',
    `Write your findings to this file: ${join(dossier.dir, `plan-check-${worklog(dossier).filter((line) => RECORD.test(line)).length + 1}.md`)}`,
    'End it with one line: VERDICT: PASS or VERDICT: CHANGES.',
    '',
    '## Plan',
    '',
    text.trim(),
    '',
    '## Cited lines',
    '',
    cited.join('\n\n') || 'None.',
    '',
    '## Baseline',
    '',
    '```',
    readOr(join(dossier.dir, 'baseline.txt')).trim(),
    '```',
    '',
    '## Files in the planned paths',
    '',
    files.map((f) => `- ${f}`).join('\n') || 'None yet.',
  ].join('\n')
  const out = join(dossier.dir, 'pack-plan.md')
  write(out, pack)
  log(dossier, `pack plan ${hash}`)
  return out
}

export function verdictOf(findings: string): 'PASS' | 'CHANGES' {
  const found = [...findings.matchAll(/^(?:VERDICT|REVIEW|SIGNOFF): (PASS|CHANGES)\s*$/gm)].pop()
  if (!found?.[1]) throw new Refusal('the findings file has no line VERDICT: PASS or VERDICT: CHANGES')
  return found[1] as 'PASS' | 'CHANGES'
}

export type Finding = { kind: 'block' | 'note'; n: number; line: string }

export function findingsOf(text: string): Finding[] {
  const count = { block: 0, note: 0 }
  const out: Finding[] = []
  for (const line of text.split('\n')) {
    const kind = /^\s*(?:(?:[-*]|\d+[.)])\s+)?(?:.*?:\s*)?\*{0,2}(block|note)\*{0,2}:\*{0,2}\s/.exec(line)?.[1] as Finding['kind'] | undefined
    if (kind) out.push({ kind, n: (count[kind] += 1), line: line.trim() })
  }
  return out
}

const RECORD = / record plan (PASS|CHANGES) [0-9a-f]{12} (.+)$/
const NO_FINDING = 'has no block: or note: line'
const PACKED_PLAN = /\n## Plan\n\n([\s\S]*)\n\n## Cited lines\n/

function packedText(dossier: Dossier): string {
  const text = PACKED_PLAN.exec(readOr(join(dossier.dir, 'pack-plan.md')))?.[1] ?? ''
  const recorded = worklog(dossier).findLast((line) => RECORD.test(line)) ?? ''
  return text && / record plan \w+ ([0-9a-f]{12}) /.exec(recorded)?.[1] === planHash(text) ? text : ''
}

export const checkedText = (dossier: Dossier): string => readOr(join(dossier.dir, 'checked-plan.md')) || packedText(dossier)

export type PlanCheck = { verdict: string; findings: string; ruled: boolean }

export function lastPlanCheck(cwd: string, dossier: Dossier): PlanCheck | undefined {
  const lines = worklog(dossier)
  const at = lines.findLastIndex((line) => RECORD.test(line))
  const [, verdict = '', path = ''] = RECORD.exec(lines[at] ?? '') ?? []
  if (!verdict) return undefined
  const ruled = verdict === 'PASS' || lines.slice(at).some((line) => / amend [0-9a-f]{12} /.test(line))
  return { verdict, findings: isAbsolute(path) ? path : join(ledgerRoot(cwd), path), ruled }
}

export function scopeMoved(dossier: Dossier, text: string): 'Goal' | 'Scope' | undefined {
  const before = checkedText(dossier)
  return (['Goal', 'Scope'] as const).find((name) => before !== '' && section(before, name) !== section(text, name))
}

export function cmdRecordPlan(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const path = args._[0] ? resolve(cwd, args._[0]) : ''
  if (!path || !existsSync(path)) throw new Refusal('usage: ds record plan <findings file>', 2)
  const findings = read(path)
  const verdict = verdictOf(findings)
  const found = findingsOf(findings)
  if (verdict === 'CHANGES' && !found.length)
    throw new Refusal(`the findings file says CHANGES and ${NO_FINDING}; each finding is one line "<path>:<line>: block: <text>" or "... note: <text>"`)
  const text = read(dossier.file)
  const hash = planHash(text)
  log(dossier, `record plan ${verdict} ${hash} ${path}`)
  write(join(dossier.dir, 'checked-plan.md'), text)
  if (verdict === 'PASS') {
    write(dossier.file, setHeader(text, 'checked', hash))
    return `PLAN CHECK: PASS ${hash}`
  }
  const count = (kind: Finding['kind']) => found.filter((f) => f.kind === kind).length
  const head = `PLAN CHECK: CHANGES, ${count('block')} block and ${count('note')} note lines. Rule on each one, then run ds amend <rulings file>: ${path}`
  throw new Refusal([head, ...found.map((f) => `${f.kind} ${f.n}: ${f.line}`)].join('\n'))
}

const RULING_FORM = '"block <n>: fixed|refused: <what shows it>" or "note <n>: taken: <why>|row O<id>|dropped: <reason>"'

function unruled(root: string, findings: Finding[], rulings: string): string[] {
  const ruled = (f: Finding): boolean => {
    const found = new RegExp(`^\\s*(?:[-*]\\s*)?${f.kind} ${f.n}: (fixed: \\S|refused: \\S|taken: \\S|dropped: \\S|row (O\\d+)\\b)`, 'm').exec(rulings)
    if (!found) return false
    const verb = (found[1] ?? '').split(/[: ]/)[0] ?? ''
    if (!(f.kind === 'block' ? ['fixed', 'refused'] : ['taken', 'dropped', 'row']).includes(verb)) return false
    return !found[2] || rowFiles(root).some((file) => scanRows(read(file)).rows.some((row) => row.id === found[2]))
  }
  return findings.filter((f) => !ruled(f)).map((f) => `${f.kind} ${f.n}`)
}

export function cmdAmend(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const path = args._[0] ? resolve(cwd, args._[0]) : ''
  if (!path || !existsSync(path)) throw new Refusal('usage: ds amend <rulings file>', 2)
  const rulings = read(path)
  const text = read(dossier.file)
  const problems = lint(text).length
  if (problems) throw new Refusal(`run ds lint first: ${problems} problems`)
  const last = lastPlanCheck(cwd, dossier)
  if (!last) throw new Refusal('no plan check yet: run ds pack plan, get the plan check, then ds record plan')
  const hash = planHash(text)
  if (header(text).checked === hash) return `PLAN: checked ${hash}, nothing to amend`
  if (!checkedText(dossier)) throw new Refusal('this plan was checked before ds kept the checked text; run ds pack plan and a fresh plan check')
  const moved = scopeMoved(dossier, text)
  if (moved) throw new Refusal(`the ${moved} changed since the plan check; run ds pack plan and a fresh plan check`)
  if (!worklog(dossier).some((line) => line.endsWith(`check --baseline OK ${hash}`))) throw new Refusal('run ds check --baseline on this plan first')
  if (!last.ruled) {
    if (!existsSync(last.findings)) throw new Refusal(`the findings file ${last.findings} is gone; run ds pack plan and a fresh plan check`)
    const found = findingsOf(read(last.findings))
    if (!found.length) throw new Refusal(`the findings file ${last.findings} ${NO_FINDING}; run ds pack plan and a fresh plan check`)
    const open = unruled(ledgerRoot(cwd), found, rulings)
    if (open.length) throw new Refusal(`no ruling for: ${open.join(', ')}. Each finding needs one line: ${RULING_FORM}`)
  } else if (!rulings.trim()) throw new Refusal('the notes file is empty; say what changed and why')
  const kept = join(dossier.dir, 'rulings.md')
  write(kept, `${readOr(kept, `# Rulings: ${dossier.slug}\n`).trimEnd()}\n\n## ${now()} ${hash}\n\n${rulings.trim()}`)
  write(dossier.file, setHeader(text, 'checked', hash))
  log(dossier, `amend ${hash} ${path}`)
  return `PLAN: amended ${hash}`
}

export function cmdTriage(cwd: string, args: Args): string {
  const root = ledgerRoot(cwd)
  const view = triage(root)
  if (args.flags.json) return JSON.stringify(view)
  writeLaterView(root)
  return args.flags.start ? renderStart(view) : render(view)
}

export function cmdPath(cwd: string, args: Args): string {
  return dossierOf(cwd, args).dir
}

export function rowsOf(dossier: Dossier): Row[] {
  return rows(read(dossier.file)).rows
}
