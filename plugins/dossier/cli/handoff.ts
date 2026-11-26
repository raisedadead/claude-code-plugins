import { resolve } from 'node:path'
import { commitsIn, fixupTarget, landedOn, REVIEWER, reviewedBy, reviews, sameBranch } from '../engine/branch.ts'
import { header, lint, noteOf, planHash, rows } from '../engine/plan.ts'
import { isOpen, ready, type State, waitsOnOperator } from '../engine/rows.ts'
import { firstReady, rowStates } from '../engine/triage.ts'
import { git, gitTry, Refusal, run } from '../engine/sh.ts'
import { currentBranch, type Dossier, holdOf, ledgerRoot, liveDossiers, log, read, rootsOf, sessionsOf, workTree, worklog } from '../engine/store.ts'
import { type Args, checkedText, dossierOf, flag, lastPlanCheck, rowsOf, scopeMoved } from './plan.ts'

const GREEN = new Set(['success', 'skipped', 'neutral'])

function revOf(cwd: string, rev: string): string | undefined {
  const done = gitTry(cwd, 'rev-parse', '--verify', '--quiet', rev)
  return done.code === 0 ? done.out.trim() : undefined
}

function planStep(cwd: string, dossier: Dossier, text: string): string {
  const problems = lint(text).length
  if (problems) return `next: /dossier:plan — ds lint has ${problems} problems`
  const hash = planHash(text)
  const lines = worklog(dossier)
  if (!lines.some((line) => line.endsWith(`check --baseline OK ${hash}`))) return 'next: /dossier:plan — run ds check --baseline'
  const last = lastPlanCheck(cwd, dossier)
  if (!last) return 'next: /dossier:plan — ds pack plan and the plan check'
  if (!checkedText(dossier)) return 'next: /dossier:plan — ds kept no checked text of this plan: ds pack plan and a fresh plan check'
  if (scopeMoved(dossier, text)) return 'next: /dossier:plan — the Goal or the Scope changed: ds pack plan and a fresh plan check'
  if (!last.ruled) return `next: /dossier:plan — rule on each finding of ${last.findings}, then ds amend <rulings file>`
  return 'next: /dossier:plan — the plan changed after its check: ds amend <notes file>'
}

function remoteOf(cwd: string, branch: string): string {
  return gitTry(cwd, 'config', `branch.${branch}.remote`).out.trim() || 'origin'
}

function ciLine(dossier: Dossier, sha: string): string | undefined {
  return worklog(dossier)
    .filter((line) => / ci (start|OK|NONE|FAIL) /.test(line) && line.includes(` ${sha}`))
    .pop()
}

function shipStep(cwd: string, dossier: Dossier, head: Record<string, string>, open: boolean): string | undefined {
  const branch = head.branch ?? ''
  const base = head.base ?? 'main'
  const tip = revOf(cwd, `refs/heads/${branch}`)
  if (!tip) return `next: /dossier:build — no branch ${branch} yet`
  const tree = git(cwd, 'rev-parse', `${tip}^{tree}`)
  const passed = reviews(cwd).some((r) => sameBranch(r.branch, branch) && r.tree === tree && r.verdict === 'PASS' && reviewedBy(r, REVIEWER))
  if (!passed) return 'next: /dossier:ship — review the branch'
  const from = gitTry(cwd, 'merge-base', base, tip).out.trim()
  const fixups = from ? commitsIn(cwd, `${from}..${tip}`).filter((c) => fixupTarget(c.subject)).length : 0
  if (fixups) return `next: /dossier:ship — ds shape folds ${fixups} fixup! commits`
  const ci = ciLine(dossier, tip)
  const remote = remoteOf(cwd, branch)
  const out = revOf(cwd, `refs/remotes/${remote}/${branch}`) === tip || landedOn(cwd, tip, `refs/remotes/${remote}/${base}`)
  if (!ci && !out) return `next: /dossier:ship — land ${branch}`
  if (!ci) return 'next: ds ci'
  if (/ ci start /.test(ci)) return `next: ds ci — started ${ci.split(' ').slice(1, 3).join(' ')} UTC; run it again if it stopped`
  if (/ ci FAIL /.test(ci)) return `ci: ${ci.split(` ${tip} `)[1] ?? ''}`.trimEnd()
  return open ? undefined : 'close: /dossier:close "<one line>"'
}

export function cmdHandoff(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const hold = holdOf(ledgerRoot(cwd), dossier)
  if (hold)
    return `held: ${dossier.slug} waits on its line ${hold.id} (${hold.state}${hold.tail ? `: ${hold.tail}` : ''}); resume: ds set ${hold.id} next --who A`
  const text = read(dossier.file)
  const head = header(text)
  if (head.checked !== planHash(text)) return planStep(cwd, dossier, text)
  if (head.state === 'plan' && !worklog(dossier).some((line) => line.includes(' subtract: ')))
    return 'operator: pick the subtraction cuts; then ds log "subtract: ..."'
  const all = rowsOf(dossier)
  const states = rowStates(ledgerRoot(cwd))
  const waiting = all.filter((r) => waitsOnOperator(r, states))
  const out = waiting.map((r) => `operator: ${r.id} ${r.title}${r.state === 'wait' && r.tail ? ` · ${r.tail}` : ''}`)
  const open = (r: (typeof all)[number]) => r.state === 'now' || r.state === 'next'
  const blocked = all.filter((r) => isOpen(r) && !ready(r, states))
  const step = firstReady(all, states) ? 'next: /dossier:build' : blocked.length ? undefined : shipStep(workTree(cwd), dossier, head, all.some(open))
  if (step) out.push(step)
  if (!out.length) out.push(...blocked.map((r) => `blocked: ${r.id} ${r.title} · ${r.tail}`))
  return out.join('\n')
}

function statusOf(root: string, dossier: Dossier, states: ReadonlyMap<string, State>): string {
  const parts = [dossier.slug, header(read(dossier.file)).state ?? '?']
  const hold = holdOf(root, dossier)
  const all = rowsOf(dossier).filter((r) => r.state !== 'drop' && r.state !== 'later')
  const held = hold ? [`held: ${hold.id} ${hold.state}`] : []
  if (!all.length) return [...parts, 'no rows', ...held].join(' · ')
  const done = all.filter((r) => r.state === 'done').length
  parts.push(`${done}/${all.length}`)
  if (hold) return [...parts, ...held].join(' · ')
  const next = firstReady(all, states)
  const waiting = all.filter((r) => waitsOnOperator(r, states))
  if (next) parts.push(`next ${next.id}`)
  if (waiting.length) parts.push(`[H] ${waiting.length}`)
  return parts.join(' · ')
}

export function cmdStatus(cwd: string, args: Args): string {
  const root = ledgerRoot(cwd)
  const live = liveDossiers(root)
  const states = rowStates(root)
  const line = (d: Dossier): string => statusOf(root, d, states)
  const session = flag(args, 'session')
  if (session !== undefined)
    return live
      .filter((d) => sessionsOf(d).includes(session))
      .map(line)
      .join('\n')
  const branch = currentBranch(cwd)
  const own = live.filter((d) => {
    const name = header(read(d.file)).branch
    return name && (sameBranch(name, branch) || branch.startsWith(`${name}-lane-`))
  })
  return (own.length === 1 ? own : live).map(line).join('\n')
}

function rowsEntry(root: string, dossier: Dossier, states: ReadonlyMap<string, State>, session: string | undefined): object {
  const text = read(dossier.file)
  const kept = rows(text).rows.filter((r) => r.state !== 'drop')
  const hold = holdOf(root, dossier)
  const next = hold ? undefined : firstReady(kept, states)
  return {
    slug: dossier.slug,
    ...(next ? { next: `${next.id} ${next.title}` } : {}),
    state: header(text).state ?? '?',
    done: kept.filter((r) => r.state === 'done').length,
    rows: kept.length,
    pinned: session !== undefined && sessionsOf(dossier).includes(session),
    needs: hold ? [] : kept.filter((r) => waitsOnOperator(r, states)).map((r) => r.id),
    ...(hold ? { hold: { id: hold.id, state: hold.state, tail: hold.tail, after: !ready(hold, states) } } : {}),
    items: kept
      .filter((r) => r.state !== 'done')
      .map((r) => {
        const note = noteOf(text, r.id)
        return { id: r.id, state: r.state, who: r.who, title: r.title, tail: r.tail, ...(note ? { note } : {}) }
      }),
  }
}

export function cmdRows(cwd: string, args: Args): string {
  const root = ledgerRoot(cwd)
  const states = rowStates(root)
  const session = flag(args, 'session')
  const own = liveDossiers(root).map((d) => rowsEntry(root, d, states, session))
  const others = (session === undefined ? [] : rootsOf(session))
    .filter((other) => other !== resolve(root))
    .flatMap((other) => {
      try {
        const theirs = rowStates(other)
        return liveDossiers(other)
          .filter((d) => sessionsOf(d).includes(session ?? ''))
          .map((d) => ({ ...rowsEntry(other, d, theirs, session), repo: other }))
      } catch {
        return []
      }
    })
  return JSON.stringify({ dossiers: [...own, ...others] })
}

function pause(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback)
  return (Number.isFinite(value) && value >= 0 ? value : fallback) * 1000
}

type Run = {
  databaseId: number
  name: string
  status: string
  conclusion: string
  url: string
  workflowName?: string
  event?: string
  createdAt?: string
  repo?: string
}

const RUN_FIELDS = 'databaseId,name,status,conclusion,url,workflowName,event,createdAt'

export function cmdCi(cwd: string, args: Args): string {
  const dossier = dossierOf(cwd, args)
  const head = header(read(dossier.file))
  const branch = head.branch ?? ''
  const tree = workTree(cwd)
  const remote = remoteOf(tree, branch)
  const sha = revOf(tree, `refs/heads/${branch}`)
  const pushed = revOf(tree, `refs/remotes/${remote}/${branch}`)
  const landed = sha !== undefined && landedOn(tree, sha, `refs/remotes/${remote}/${head.base ?? 'main'}`)
  if (!sha || (!landed && !pushed)) throw new Refusal(`${branch} is not pushed to ${remote}; push it first`, 2)
  if (!landed && pushed !== sha) throw new Refusal(`${branch} has commits that are not pushed; push them first`, 2)
  const url = git(tree, 'remote', 'get-url', remote)
  const repo = /[:/]([^/:]+\/[^/]+?)(?:\.git)?$/.exec(url)?.[1] ?? url
  const appear = seconds('DS_CI_APPEAR', 60)
  const every = seconds('DS_CI_POLL', 15)
  const limit = seconds('DS_CI_LIMIT', 3600)
  const start = Date.now()
  log(dossier, `ci start ${sha}`)
  const gh = (...argv: string[]): unknown => {
    const done = run(['gh', ...argv], tree)
    if (done.code !== 0) throw new Refusal(`gh failed: ${done.err.trim() || `exit ${done.code}`}`, 2)
    try {
      return JSON.parse(done.out || 'null')
    } catch {
      throw new Refusal(`gh failed: gh ${argv.slice(0, 2).join(' ')} printed no JSON`, 2)
    }
  }
  const { parent } = (gh('repo', 'view', repo, '--json', 'parent') ?? {}) as { parent?: { name: string; owner: { login: string } } | null }
  const repos = parent ? [repo, `${parent.owner.login}/${parent.name}`] : [repo]
  const newer = (old: Run, other: Run): boolean => {
    const [was, is] = [old.createdAt ?? '', other.createdAt ?? '']
    return is > was || (is === was && other.databaseId > old.databaseId)
  }
  const ranAgain = (old: Run, other: Run): boolean =>
    Boolean(old.workflowName) && old.repo === other.repo && old.workflowName === other.workflowName && old.event === other.event && newer(old, other)
  for (;;) {
    const listed = repos.flatMap((name) =>
      ((gh('run', 'list', '--repo', name, '--commit', sha, '--json', RUN_FIELDS) ?? []) as Run[]).map((r) => ({ ...r, repo: name })),
    )
    const runs = listed.filter((r) => r.conclusion !== 'cancelled' || !listed.some((other) => ranAgain(r, other)))
    const waited = Date.now() - start
    if (!runs.length && waited >= appear) {
      log(dossier, `ci NONE ${sha}`)
      return `CI: NONE, no run for ${sha.slice(0, 7)} after ${appear / 1000} s`
    }
    // A slower workflow can register after a fast one finishes, so a verdict waits out the same window.
    if (runs.length && runs.every((r) => r.status === 'completed') && waited >= appear) {
      const held = runs.filter((r) => r.conclusion === 'action_required')
      const failed = runs.filter((r) => !GREEN.has(r.conclusion) && !held.includes(r))
      if (failed.length) {
        log(dossier, `ci FAIL ${sha} ${failed.map((r) => r.url).join(' ')}`)
        throw new Refusal(`FAIL\n${failed.map((r) => `${r.name} ${r.conclusion} ${r.url}`).join('\n')}`)
      }
      if (held.length) throw new Refusal(`a run waits for approval; run ds ci again after the approval\n${held.map((r) => `${r.name} ${r.url}`).join('\n')}`, 3)
      log(dossier, `ci OK ${sha}`)
      return `CI: OK, ${runs.length} runs for ${sha.slice(0, 7)}`
    }
    if (waited >= limit) {
      const running = runs.filter((r) => r.status !== 'completed').map((r) => `${r.name} ${r.url}`)
      throw new Refusal(`still running after ${Math.round(limit / 60000)} min; run ds ci again\n${running.join('\n')}`.trimEnd(), 3)
    }
    pause(every)
  }
}
