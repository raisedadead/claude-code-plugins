import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import {
  addReview,
  changedPaths,
  clean,
  commitsIn,
  conflicted,
  defaultBase,
  fixupTarget,
  mergeBase,
  onRemote,
  patchId,
  reviews,
  tree as treeOf,
} from '../engine/branch.ts'
import { checks, commits, edges, header, replaceSection, rows, section, setHeader, setRow } from '../engine/plan.ts'
import { formatRow } from '../engine/rows.ts'
import { git, gitTry, Refusal, run } from '../engine/sh.ts'
import {
  currentBranch,
  type Dossier,
  dossierHome,
  ledgerRoot,
  log,
  now,
  read,
  readOr,
  REGISTER_HEAD,
  registerFile,
  scratch,
  workTree,
  worklog,
  write,
} from '../engine/store.ts'
import { render, triage, writeLaterView } from '../engine/triage.ts'
import { type Args, dossierOf, flag, runChecks, verdictOf } from './plan.ts'

function optionalDossier(cwd: string, args: Args): Dossier | undefined {
  try {
    return dossierOf(cwd, args)
  } catch (error) {
    if (flag(args, 'dossier')) throw error
    return undefined
  }
}

function baseOf(cwd: string, args: Args, dossier?: Dossier): string {
  return flag(args, 'base') ?? (dossier ? header(read(dossier.file)).base : undefined) ?? defaultBase(cwd)
}

export function cmdPackReview(cwd: string, args: Args): string {
  const dossier = optionalDossier(cwd, args)
  const tree = workTree(cwd)
  const base = baseOf(cwd, args, dossier)
  const branch = currentBranch(tree)
  const from = mergeBase(tree, base)
  const last = reviews(tree)
    .filter((r) => r.branch === branch)
    .pop()
  const since = !args.flags.full && last && gitTry(tree, 'cat-file', '-e', last.tree).code === 0 ? last.tree : undefined
  const diff = git(tree, 'diff', since ?? from, 'HEAD')
  const parts = [`# Review pack: ${branch}`, '', 'End your findings file with one line: VERDICT: PASS or VERDICT: CHANGES.', '']
  if (dossier) {
    const text = read(dossier.file)
    const result = runChecks(cwd, dossier, false)
    const guards = checks(text).checks.filter((c) => c.guard)
    parts.push('## Goal', '', section(text, 'Goal'), '', '## Scope', '', section(text, 'Scope'), '')
    parts.push('## Invariants (guard checks)', '', ...(guards.length ? guards.map((c) => `- ${c.name}: \`${c.command}\``) : ['None.']), '')
    parts.push('## Edge cases', '', ...edges(text).map((e) => `- ${e.text} → ${e.refs.join(' ')}`), '')
    parts.push('## Check output', '', '```', result.text, '```', '')
  }
  parts.push(`## Diff ${since ? `since the last review (${since.slice(0, 7)})` : `from ${base}`}`, '', '```diff', diff, '```')
  const out = dossier ? join(dossier.dir, 'pack-review.md') : join(scratch(ledgerRoot(cwd)), 'tmp', `pack-review-${branch.replace(/\//g, '-')}.md`)
  write(out, parts.join('\n'))
  if (dossier) log(dossier, `pack review ${since ? 'since ' + since.slice(0, 7) : 'full'}`)
  return out
}

export function cmdRecordReview(cwd: string, args: Args): string {
  const path = args._[0]
  if (!path || !existsSync(path)) throw new Refusal('usage: ds record review <findings file>', 2)
  const verdict = verdictOf(read(path))
  const dossier = optionalDossier(cwd, args)
  const tree = workTree(cwd)
  const base = baseOf(cwd, args, dossier)
  const from = mergeBase(tree, base)
  const review = {
    time: now(),
    branch: currentBranch(tree),
    base,
    head: git(tree, 'rev-parse', 'HEAD'),
    tree: treeOf(tree),
    patch: patchId(tree, from),
    verdict,
    findings: path,
  }
  addReview(tree, review)
  if (dossier) {
    log(dossier, `record review ${verdict} ${review.tree.slice(0, 12)} ${path}`)
    if (verdict === 'PASS') write(dossier.file, setHeader(read(dossier.file), 'state', 'ship'))
  }
  if (verdict === 'CHANGES') throw new Refusal(`REVIEW: CHANGES recorded; turn the accepted findings into rows: ${path}`)
  return `REVIEW: PASS recorded for tree ${review.tree.slice(0, 12)}`
}

export function cmdShape(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const text = read(dossier.file)
  const head = header(text)
  const tree = workTree(cwd)
  if (currentBranch(tree) !== head.branch) throw new Refusal(`switch to ${head.branch} first`)
  if (!clean(tree)) throw new Refusal('commit or stash your changes first')
  const planned = commits(text).map((c) => c.subject)
  const range = commitsIn(tree, `${mergeBase(tree, head.base ?? 'main')}..HEAD`)
  const before = treeOf(tree)
  const fixups = range.filter((c) => fixupTarget(c.subject))
  if (!fixups.length) {
    const started = [...worklog(dossier)].reverse().find((line) => / shape (start|OK) /.test(line))
    const shapedBefore = started?.split(' ').pop()
    if (shapedBefore === before && range.map((c) => c.subject).join('\n') === planned.join('\n')) {
      log(dossier, `shape OK ${before}`)
      return 'SHAPE: OK (already shaped)'
    }
  }
  for (const commit of range) {
    const target = fixupTarget(commit.subject) ?? commit.subject
    if (!planned.includes(target)) throw new Refusal(`${commit.sha.slice(0, 7)} "${commit.subject}" is not a planned commit or a fixup! of one`)
  }
  for (const subject of planned) {
    if (range.filter((c) => c.subject === subject).length !== 1) throw new Refusal(`"${subject}" needs exactly one anchor commit; run ds anchors`)
    if (!range.some((c) => fixupTarget(c.subject) === subject)) {
      const anchor = range.find((c) => c.subject === subject)
      if (!anchor || !changedPaths(tree, anchor.sha).length) throw new Refusal(`planned commit "${subject}" has no work; drop it from the plan or build it`)
    }
  }
  let onto = mergeBase(tree, head.base ?? 'main')
  for (const commit of range) if (onRemote(tree, commit.sha)) onto = commit.sha
  const rewritten = range.slice(range.findIndex((c) => c.sha === onto) + 1)
  const pushed = range.slice(0, range.length - rewritten.length).map((c) => c.subject)
  for (const fix of fixups) {
    if (pushed.includes(fixupTarget(fix.subject) ?? '') && !rewritten.some((c) => c.subject === fixupTarget(fix.subject))) {
      throw new Refusal(`"${fixupTarget(fix.subject)}" is already pushed; plan the fix as a new commit`)
    }
  }
  const orig = git(tree, 'rev-parse', 'HEAD')
  log(dossier, `shape start ${before}`)
  const done = run(['git', 'rebase', '-i', '--autosquash', onto], tree, { env: { GIT_SEQUENCE_EDITOR: 'true', GIT_EDITOR: 'true' } })
  if (done.code !== 0) {
    const paths = conflicted(tree)
    if (paths.length) throw new Refusal(`CONFLICT:\n${paths.join('\n')}\nResolve, git rebase --continue, then run ds shape again`)
    gitTry(tree, 'rebase', '--abort')
    throw new Refusal(`rebase failed: ${done.err.trim()}`)
  }
  const after = commitsIn(tree, `${mergeBase(tree, head.base ?? 'main')}..HEAD`)
  const problems: string[] = []
  if (treeOf(tree) !== before) problems.push('the files changed during shaping')
  if (after.map((c) => c.subject).join('\n') !== planned.join('\n'))
    problems.push(`the subjects differ from the plan:\n${after.map((c) => c.subject).join('\n')}`)
  for (const c of after) if (c.body) problems.push(`"${c.subject}" has a body`)
  if (problems.length) {
    git(tree, 'reset', '--hard', orig)
    throw new Refusal(`SHAPE: refused, history restored\n${problems.join('\n')}`)
  }
  log(dossier, `shape OK ${before}`)
  return `SHAPE: OK, ${after.length} commits`
}

export function cmdShipArgs(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const head = header(read(dossier.file))
  const url = git(workTree(cwd), 'remote', 'get-url', 'origin')
  const repo = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? url
  return JSON.stringify({ repo, branch: head.branch, base: head.base, title: head.pr })
}

export function cmdClose(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const line = args._.join(' ').trim()
  if (!line) throw new Refusal('usage: ds close "<one line>"', 2)
  const root = ledgerRoot(cwd)
  let text = read(dossier.file)
  const all = rows(text).rows
  const open = all.filter((r) => r.state === 'now' || r.state === 'next')
  if (open.length) throw new Refusal(`open rows; finish, defer or drop them first:\n${open.map(formatRow).join('\n')}`)
  const target = join(dossierHome(root), '_archive', dossier.name)
  if (existsSync(target)) throw new Refusal(`${target} already exists`)
  const carry = all.filter((r) => r.state === 'wait' || r.state === 'later')
  const own = header(text).row
  const registerText = readOr(registerFile(root), REGISTER_HEAD)
  const ownRow = own ? rows(registerText).rows.find((r) => r.id === own) : undefined
  if (carry.length || ownRow) {
    let register = registerText
    if (ownRow) register = setRow(register, ownRow, formatRow({ ...ownRow, state: 'done', tail: line }))
    const body = section(register, 'Rows')
    if (carry.length) register = replaceSection(register, 'Rows', [body, ...carry.map(formatRow)].filter(Boolean).join('\n'))
    const notes = section(text, 'Notes').split(/^(?=### )/m)
    const moved = notes.filter((block) => carry.some((r) => block.startsWith(`### ${r.id}\n`)))
    if (moved.length) register = replaceSection(register, 'Notes', [section(register, 'Notes'), ...moved.map((b) => b.trim())].filter(Boolean).join('\n\n'))
    write(registerFile(root), register)
  }
  text = setHeader(setHeader(text, 'state', 'done'), 'closed', `${now().slice(0, 10)} ${line}`)
  write(dossier.file, text)
  log(dossier, `close ${line}${carry.length ? `; moved ${carry.map((r) => r.id).join(' ')} to OPEN-WORK.md` : ''}`)
  write(join(dossierHome(root), '_archive', '.keep'), '')
  renameSync(dossier.dir, target)
  writeLaterView(root)
  return `closed ${dossier.slug} → ${target}\n${render(triage(root))}`
}
