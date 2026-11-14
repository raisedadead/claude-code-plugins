import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defaultBase, globMatch } from '../engine/branch.ts'
import { appendRow, checks, commits, lint, planHash, rows, setHeader, setRow, template } from '../engine/plan.ts'
import { formatRow, type Row, type State, STATES, scanRows, shapeErrors, type Who } from '../engine/rows.ts'
import { git, lines, Refusal, run } from '../engine/sh.ts'
import {
  type Dossier,
  dossierHome,
  ledgerRoot,
  liveDossiers,
  log,
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
import { render, triage, writeLaterView } from '../engine/triage.ts'

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
  write(join(dir, 'DOSSIER.md'), template(slug, branch, flag(args, 'base') ?? defaultBase(cwd)))
  const dossier = { dir, name, slug, file: join(dir, 'DOSSIER.md') }
  log(dossier, `new ${slug} branch ${branch}`)
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

export function setState(root: string, id: string, state: State, tail?: string): string {
  if (!STATES.includes(state)) throw new Refusal(`state must be one of ${STATES.join(', ')}`, 2)
  const { file, row } = findRow(root, id)
  const next = checked({ ...row, state, tail: tail ?? (state === row.state ? row.tail : '') })
  write(file, setRow(read(file), row, formatRow(next)))
  logFor(root, file, `set ${formatRow(next).slice(2)}`)
  return formatRow(next)
}

export function cmdSet(cwd: string, args: Args): string {
  const [id = '', state = '', ...tail] = args._
  if (!/^O\d+$/.test(id)) throw new Refusal('usage: ds set <O-id> <state> [tail]', 2)
  return setState(ledgerRoot(cwd), id, state as State, tail.length ? tail.join(' ') : undefined)
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
    const good = baseline && !stays ? !passed : passed
    if (!good) ok = false
    const want = baseline && !stays ? `anything but exit ${check.expect}` : `exit ${check.expect}`
    out.push(`${good ? 'OK' : 'FAIL'} ${check.name}${check.guard ? ' (guard)' : built ? ' (built)' : ''}: exit ${ran.code}, want ${want}`)
    const tail = `${ran.out}${ran.err}`.trim().split('\n').slice(-5).join('\n')
    if (!good && tail) out.push(tail.replace(/^/gm, '  '))
  }
  return { ok, text: out.join('\n') }
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
    'End your findings file with one line: VERDICT: PASS or VERDICT: CHANGES.',
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

export function cmdRecordPlan(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const path = args._[0]
  if (!path || !existsSync(path)) throw new Refusal('usage: ds record plan <findings file>', 2)
  const verdict = verdictOf(read(path))
  const text = read(dossier.file)
  const hash = planHash(text)
  log(dossier, `record plan ${verdict} ${hash} ${path}`)
  if (verdict === 'PASS') {
    write(dossier.file, setHeader(text, 'checked', hash))
    return `PLAN CHECK: PASS ${hash}`
  }
  const changes = worklog(dossier).filter((line) => / record plan CHANGES /.test(line)).length
  if (changes >= 2) throw new Refusal(`PLAN CHECK: CHANGES, the second one; take the findings to the operator: ${path}`, 3)
  throw new Refusal(`PLAN CHECK: CHANGES; change the plan, then run ds check --baseline, ds pack plan and a fresh check: ${path}`)
}

export function cmdTriage(cwd: string, args: Args): string {
  const root = ledgerRoot(cwd)
  const view = triage(root)
  if (args.flags.json) return JSON.stringify(view)
  writeLaterView(root)
  return render(view)
}

export function cmdPath(cwd: string, args: Args): string {
  return dossierOf(cwd, args).dir
}

export function rowsOf(dossier: Dossier): Row[] {
  return rows(read(dossier.file)).rows
}
