import { commitsIn, fixupTarget, landedOn, REVIEWER, reviewedBy, reviews, sameBranch } from '../engine/branch.ts'
import { header, lint, planHash } from '../engine/plan.ts'
import { git, gitTry, Refusal, run } from '../engine/sh.ts'
import { type Dossier, log, read, workTree, worklog } from '../engine/store.ts'
import { type Args, checkedText, dossierOf, lastPlanCheck, rowsOf, scopeMoved } from './plan.ts'

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
  const text = read(dossier.file)
  const head = header(text)
  if (head.checked !== planHash(text)) return planStep(cwd, dossier, text)
  if (head.state === 'plan' && !worklog(dossier).some((line) => line.includes(' subtract: ')))
    return 'operator: pick the subtraction cuts; then ds log "subtract: ..."'
  const all = rowsOf(dossier)
  const waiting = all.filter((r) => r.state === 'wait' || (r.who === 'H' && (r.state === 'now' || r.state === 'next')))
  const out = waiting.map((r) => `operator: ${r.id} ${r.title}`)
  const open = (r: (typeof all)[number]) => r.state === 'now' || r.state === 'next'
  const step = all.some((r) => r.who === 'A' && open(r)) ? 'next: /dossier:build' : shipStep(workTree(cwd), dossier, head, all.some(open))
  if (step) out.push(step)
  return out.join('\n')
}

function pause(ms: number): void {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function seconds(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback)
  return (Number.isFinite(value) && value >= 0 ? value : fallback) * 1000
}

type Run = { databaseId: number; name: string; status: string; conclusion: string; url: string }

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
  for (;;) {
    const listed = run(['gh', 'run', 'list', '--repo', repo, '--commit', sha, '--json', 'databaseId,name,status,conclusion,url'], tree)
    if (listed.code !== 0) throw new Refusal(`gh failed: ${listed.err.trim() || `exit ${listed.code}`}`, 2)
    const runs = JSON.parse(listed.out || '[]') as Run[]
    const waited = Date.now() - start
    if (!runs.length && waited >= appear) {
      log(dossier, `ci NONE ${sha}`)
      return `CI: NONE, no run for ${sha.slice(0, 7)} after ${appear / 1000} s`
    }
    // A slower workflow can register after a fast one finishes, so a verdict waits out the same window.
    if (runs.length && runs.every((r) => r.status === 'completed') && waited >= appear) {
      const failed = runs.filter((r) => !GREEN.has(r.conclusion))
      if (failed.length) {
        log(dossier, `ci FAIL ${sha} ${failed.map((r) => r.url).join(' ')}`)
        throw new Refusal(`FAIL\n${failed.map((r) => `${r.name} ${r.conclusion} ${r.url}`).join('\n')}`)
      }
      log(dossier, `ci OK ${sha}`)
      return `CI: OK, ${runs.length} runs for ${sha.slice(0, 7)}`
    }
    if (waited >= limit) throw new Refusal(`still running after ${Math.round(limit / 60000)} min; run ds ci again`, 3)
    pause(every)
  }
}
