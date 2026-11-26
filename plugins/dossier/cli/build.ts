import { join } from 'node:path'
import { changedPaths, clean, commitsIn, conflicted, fixupTarget, globMatch, mergeBase, onRemote, overlaps, worktreeOf } from '../engine/branch.ts'
import { checks, type Commit as Planned, commits, edges, header, lint, planHash, section, setHeader } from '../engine/plan.ts'
import { formatRow, isOpen, ready, waitsOnOperator } from '../engine/rows.ts'
import { firstReady, rowStates } from '../engine/triage.ts'
import { git, gitTry, Refusal } from '../engine/sh.ts'
import { currentBranch, type Dossier, ledgerRoot, log, read, workTree, worklog, write } from '../engine/store.ts'
import { type Args, dossierOf, guard, rowsOf, runChecks, setState, startLine } from './plan.ts'

function plannedFor(dossier: Dossier, id: string): Planned {
  const found = commits(read(dossier.file)).find((c) => c.rows.includes(id))
  if (!found) throw new Refusal(`${id} is in no planned commit`)
  return found
}

export function cmdAnchors(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  guard(cwd, dossier)
  const text = read(dossier.file)
  const errors = lint(text)
  if (errors.length) throw new Refusal(`run ds lint first: ${errors.length} problems`)
  const head = header(text)
  const hash = planHash(text)
  if (!worklog(dossier).some((line) => line.endsWith(`check --baseline OK ${hash}`))) throw new Refusal('run ds check --baseline on this plan first')
  if (head.checked !== hash) throw new Refusal('the plan is not checked for its current text; ds handoff names the next step')
  const tree = workTree(cwd)
  const branch = head.branch ?? ''
  if (currentBranch(tree) !== branch) {
    if (gitTry(tree, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`).code === 0) throw new Refusal(`switch to ${branch} first`)
    if (!clean(tree)) throw new Refusal('commit or stash your changes first')
    git(tree, 'switch', '-c', branch, head.base ?? 'main')
  }
  const have = new Set(commitsIn(tree, `${mergeBase(tree, head.base ?? 'main')}..HEAD`).map((c) => c.subject))
  const made: string[] = []
  for (const commit of commits(text)) {
    if (have.has(commit.subject)) continue
    git(tree, 'commit', '--allow-empty', '-m', commit.subject)
    made.push(commit.subject)
  }
  startLine(cwd, dossier, 'anchors')
  write(dossier.file, setHeader(read(dossier.file), 'state', 'build'))
  log(dossier, `anchors ${made.length} made on ${branch}`)
  return made.length ? made.map((s) => `anchor: ${s}`).join('\n') : 'anchors: all present'
}

export function lanes(planned: Planned[]): Planned[][] {
  const groups: Planned[][] = []
  for (const commit of planned) {
    const joined = groups.filter((group) => group.some((other) => overlaps(other.paths, commit.paths)))
    const merged = [...joined.flat(), commit]
    for (const group of joined) groups.splice(groups.indexOf(group), 1)
    groups.push(merged)
  }
  return groups
}

export function cmdLanes(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const branch = header(read(dossier.file)).branch ?? ''
  const groups = lanes(commits(read(dossier.file)))
  if (args.flags.json) return JSON.stringify(groups.map((group, i) => ({ lane: `${branch}-lane-${i + 1}`, commits: group })))
  return groups.map((group, i) => [`${branch}-lane-${i + 1}:`, ...group.map((c) => `- ${c.subject} (${c.rows.join(' ')})`)].join('\n')).join('\n')
}

export function cmdNext(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  guard(cwd, dossier)
  const all = rowsOf(dossier)
  const states = rowStates(ledgerRoot(cwd))
  const next = firstReady(all, states)
  if (next) return formatRow(next)
  const waiting = all.filter((r) => waitsOnOperator(r, states))
  const blocked = all.filter((r) => isOpen(r) && !ready(r, states))
  const lists = [
    waiting.length ? `waits on the operator:\n${waiting.map(formatRow).join('\n')}` : '',
    blocked.length ? `waits on other rows:\n${blocked.map(formatRow).join('\n')}` : '',
  ].filter(Boolean)
  if (lists.length) throw new Refusal(`no agent row is ready; ${lists.join('\n')}`, 3)
  throw new Refusal('no open row left; run ds check, then ds:ship', 4)
}

export function cmdMission(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  guard(cwd, dossier)
  const id = args._[0] ?? ''
  const text = read(dossier.file)
  const found = rowsOf(dossier).find((r) => r.id === id)
  if (!found) throw new Refusal(`no row ${id} in ${dossier.slug}`)
  const planned = plannedFor(dossier, id)
  if (found.state === 'next') setState(ledgerRoot(cwd), id, 'now')
  startLine(cwd, dossier, 'mission')
  const row = { ...found, state: found.state === 'next' ? ('now' as const) : found.state }
  const own = checks(text).checks.filter((c) => c.guard || c.rows.includes(id))
  const names = new Set(own.map((c) => c.name))
  const cases = edges(text).filter((e) => e.refs.some((ref) => ref === id || names.has(ref)))
  const notes = section(text, 'Notes')
    .split(/^### /m)
    .find((block) => block.startsWith(`${id}\n`))
  const mission = [
    `# Mission ${id}: ${row.title}`,
    '',
    `Goal of the dossier: ${section(text, 'Goal').replace(/\n+/g, ' ')}`,
    '',
    `Row: ${formatRow(row)}`,
    notes ? `\nNotes:\n${notes.slice(id.length).trim()}\n` : '',
    `Planned commit: ${planned.subject}`,
    `Paths you may change: ${planned.paths.join(' ')}`,
    '',
    'Checks that must pass:',
    ...own.map((c) => `- ${c.name}: \`${c.command}\` → exit ${c.expect}${c.guard ? ' (guard)' : ''}`),
    '',
    'Edge cases to handle:',
    ...(cases.length ? cases.map((e) => `- ${e.text}`) : ['- none named']),
    '',
    'Commit your work with exactly this command, as often as you like:',
    '',
    `    git commit -m "fixup! ${planned.subject}"`,
    '',
    `When done, run: ds verify ${id}`,
  ].join('\n')
  const path = join(dossier.dir, 'missions', `${id}.md`)
  write(path, mission)
  log(dossier, `mission ${id}`)
  return path
}

export function cmdVerify(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  guard(cwd, dossier)
  const id = args._[0] ?? ''
  const text = read(dossier.file)
  const planned = plannedFor(dossier, id)
  const subjects = new Set(commits(text).map((c) => c.subject))
  const tree = workTree(cwd)
  const problems: string[] = []
  if (!clean(tree)) problems.push('uncommitted changes; commit them as fixup! commits')
  const range = commitsIn(tree, `${mergeBase(tree, header(text).base ?? 'main')}..HEAD`)
  for (const commit of range) {
    const target = fixupTarget(commit.subject) ?? commit.subject
    if (!subjects.has(target)) problems.push(`${commit.sha.slice(0, 7)} "${commit.subject}" is not a planned commit or a fixup! of one`)
    const plan = commits(text).find((c) => c.subject === target)
    if (plan && fixupTarget(commit.subject)) {
      for (const path of changedPaths(tree, commit.sha)) {
        if (!plan.paths.some((p) => globMatch(p, path))) problems.push(`${commit.sha.slice(0, 7)} changes ${path}, outside the paths of "${target}"`)
      }
    }
  }
  if (!range.some((c) => fixupTarget(c.subject) === planned.subject)) problems.push(`no fixup! commit for "${planned.subject}"`)
  const result = runChecks(cwd, dossier, false, (c) => c.guard || c.rows.includes(id))
  const head = git(tree, 'rev-parse', '--short', 'HEAD')
  const ok = !problems.length && result.ok
  log(dossier, `verify ${id} ${ok ? 'PASS' : 'FAIL'} ${head}`)
  const out = [...problems, result.text, `VERIFY ${id}: ${ok ? 'PASS' : 'FAIL'}`].filter(Boolean).join('\n')
  if (!ok) throw new Refusal(out)
  return out
}

export function cmdDone(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const id = args._[0] ?? ''
  const cite = typeof args.flags.cite === 'string' ? args.flags.cite : undefined
  if (cite) return setState(ledgerRoot(cwd), id, 'done', cite)
  guard(cwd, dossier)
  const last = [...worklog(dossier)].reverse().find((line) => line.includes(` verify ${id} `))
  if (!last?.includes(' PASS ')) throw new Refusal(`run ds verify ${id} first, or give --cite "<decision>" for a row with no code`)
  const tree = workTree(cwd)
  const planned = plannedFor(dossier, id)
  const fix = commitsIn(tree, `${mergeBase(tree, headerOfText(dossier).base ?? 'main')}..HEAD`)
    .filter((c) => fixupTarget(c.subject) === planned.subject)
    .pop()
  if (!fix) throw new Refusal(`no fixup! commit for "${planned.subject}"`)
  return setState(ledgerRoot(cwd), id, 'done', fix.sha.slice(0, 7))
}

function headerOfText(dossier: Dossier): Record<string, string> {
  return header(read(dossier.file))
}

export function cmdIntegrate(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  guard(cwd, dossier)
  const lane = args._[0] ?? ''
  const main = headerOfText(dossier).branch ?? ''
  if (!lane.startsWith(`${main}-lane-`)) throw new Refusal(`usage: ds integrate <${main}-lane-N>`, 2)
  const laneTree = worktreeOf(cwd, lane)
  const mainTree = worktreeOf(cwd, main)
  if (!laneTree || !mainTree) throw new Refusal(`both ${main} and ${lane} must be checked out in a worktree`)
  const behind = gitTry(laneTree, 'merge-base', '--is-ancestor', main, lane).code !== 0
  const pushed = behind ? commitsIn(laneTree, `${main}..${lane}`).filter((c) => onRemote(laneTree, c.sha)) : []
  if (pushed.length)
    throw new Refusal(
      `${lane} has pushed commits that a rebase would rewrite: ${pushed.map((c) => c.sha.slice(0, 7)).join(' ')}\nMerge ${main} into ${lane} by hand, or plan the rest as new commits`,
    )
  const rebased = behind ? gitTry(laneTree, 'rebase', main) : { code: 0, out: '', err: '' }
  if (rebased.code !== 0) {
    const paths = conflicted(laneTree)
    log(dossier, `integrate ${lane} CONFLICT ${paths.join(' ')}`)
    throw new Refusal(
      `CONFLICT in ${laneTree}:\n${paths.join('\n') || rebased.err.trim()}\nResolve, git rebase --continue, then run ds integrate ${lane} again`,
    )
  }
  git(mainTree, 'merge', '--ff-only', lane)
  log(dossier, `integrate ${lane} OK`)
  return `${lane} is on ${main}`
}
