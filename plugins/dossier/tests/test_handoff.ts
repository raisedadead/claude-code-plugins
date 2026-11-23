import assert from 'node:assert/strict'
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { checkedPlan, ds, file, planned, recordReview, repo, sh } from './kit.ts'

const PATH = process.env.PATH

function build(cwd: string, path: string, subject: string): void {
  mkdirSync(dirname(join(cwd, path)), { recursive: true })
  writeFileSync(join(cwd, path), 'x\n')
  sh(cwd, `git add ${path} && git commit -qm "fixup! ${subject}"`)
}

function built(cwd: string): string {
  const path = checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'mission', 'O1')
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  ds(cwd, 'verify', 'O1')
  ds(cwd, 'done', 'O1')
  ds(cwd, 'mission', 'O2')
  build(cwd, 'lib/c.ts', 'feat(c): add the c module')
  ds(cwd, 'verify', 'O2')
  ds(cwd, 'done', 'O2')
  subtracted(cwd)
  return path
}

function subtracted(cwd: string): void {
  ds(cwd, 'log', 'subtract: SUBTRACT: NOTHING TO CUT; took none')
}

function review(cwd: string, _path: string, verdict: string): void {
  recordReview(cwd, verdict)
}

function pushed(cwd: string): string {
  const bare = join(mkdtempSync(join(tmpdir(), 'ds-remote-')), 'acme', 'demo.git')
  sh(cwd, `git init -q --bare ${bare} && git remote add origin ${bare} && git push -q origin demo`)
  return sh(cwd, 'git rev-parse demo')
}

// A fake gh: each call prints the next answer file, and the last one repeats.
function gh(answers: string[], code = 0): string {
  const dir = mkdtempSync(join(tmpdir(), 'ds-gh-'))
  answers.forEach((answer, i) => writeFileSync(join(dir, `answer.${i}`), answer))
  const script = `#!/bin/sh
[ "$1" = --first-run ] && exit 0
echo "$*" >> ${dir}/calls
n=$(cat ${dir}/n 2>/dev/null || echo 0)
f=${dir}/answer.$n
[ -f "$f" ] && echo $((n + 1)) > ${dir}/n || f=${dir}/answer.${answers.length - 1}
cat "$f"
exit ${code}
`
  writeFileSync(join(dir, 'gh'), script)
  chmodSync(join(dir, 'gh'), 0o755)
  sh(dir, './gh --first-run')
  process.env.PATH = `${dir}:${PATH}`
  return dir
}

beforeEach(() => {
  process.env.DS_CI_APPEAR = '0'
  process.env.DS_CI_POLL = '0'
})

afterEach(() => {
  process.env.PATH = PATH
  delete process.env.DS_CI_APPEAR
  delete process.env.DS_CI_POLL
  delete process.env.DS_CI_LIMIT
  delete process.env.DS_NOW
})

test('a plan names what it still needs before the build', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:plan — run ds check --baseline')
  ds(cwd, 'check', '--baseline')
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:plan — ds pack plan and the plan check')
  const findings = join(dirname(path), 'f.md')
  const rulings = join(dirname(path), 'r.md')
  file(findings, 'Checks: block: x\nVERDICT: CHANGES\n')
  ds(cwd, 'pack', 'plan')
  ds(cwd, 'record', 'plan', findings)
  const rule = `next: /dossier:plan — rule on each finding of ${findings}, then ds amend <rulings file>`
  assert.equal(ds(cwd, 'handoff').out, rule)
  ds(cwd, 'record', 'plan', findings)
  assert.equal(ds(cwd, 'handoff').out, rule, 'a second CHANGES is no stop')
  const kept = join(dirname(path), 'checked-plan.md')
  const pack = join(dirname(path), 'pack-plan.md')
  const text = file(kept)
  const packed = file(pack)
  sh(cwd, `rm ${kept}`)
  assert.equal(ds(cwd, 'handoff').out, rule, 'the pack of the recorded hash holds the checked text')
  sh(cwd, `rm ${pack}`)
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:plan — ds kept no checked text of this plan: ds pack plan and a fresh plan check')
  file(kept, text)
  file(pack, packed)
  file(rulings, 'block 1: refused: x is fine\n')
  assert.equal(ds(cwd, 'amend', rulings).code, 0)
  assert.match(ds(cwd, 'handoff').out, /^operator: pick the subtraction cuts/)
  file(path, file(path).replace('| b-exists | `test -f src/b.ts`', '| b-exists | `test -s src/b.ts`'))
  ds(cwd, 'check', '--baseline')
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:plan — the plan changed after its check: ds amend <notes file>')
  file(path, file(path).replace('"add b"', '"add b now"'))
  ds(cwd, 'check', '--baseline')
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:plan — the Goal or the Scope changed: ds pack plan and a fresh plan check')
  file(path, file(path).replace('## Commits', '## Commitz'))
  assert.match(ds(cwd, 'handoff').out, /^next: \/dossier:plan — ds lint has \d+ problems$/)
})

test('a checked plan waits for the subtraction cuts, then goes to the build with the operator rows beside it', () => {
  const cwd = repo()
  checkedPlan(cwd)
  assert.equal(ds(cwd, 'handoff').out, 'operator: pick the subtraction cuts; then ds log "subtract: ..."')
  subtracted(cwd)
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR\nnext: /dossier:build')
})

test('the subtraction gate holds only while the dossier is in plan', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR\nnext: /dossier:build')
})

test('the baseline wants a check of done rows to pass, so a plan can grow after the build', () => {
  const cwd = repo()
  const path = built(cwd)
  file(path, file(path).replace('| a-kept |', '| d-exists | `test -f src/d.ts` | exit 0 | no | O4 |\n| a-kept |'))
  const baseline = ds(cwd, 'check', '--baseline')
  assert.equal(baseline.code, 0, baseline.err)
  assert.match(baseline.out, /OK b-exists \(built\): exit 0, want exit 0/)
  assert.match(baseline.out, /OK d-exists: exit 1, want anything but exit 0/)
  sh(cwd, 'rm src/b.ts')
  assert.match(ds(cwd, 'check', '--baseline').err, /FAIL b-exists \(built\): exit 1, want exit 0/)
})

test('a built branch walks review, shape, push, CI and close', () => {
  const cwd = repo()
  const path = built(cwd)
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR\nnext: /dossier:ship — review the branch')
  review(cwd, path, 'CHANGES')
  assert.match(ds(cwd, 'handoff').out, /review the branch$/)
  recordReview(cwd, 'PASS', { agent: 'security-reviewer' })
  assert.match(ds(cwd, 'handoff').out, /review the branch$/)
  review(cwd, path, 'PASS')
  assert.match(ds(cwd, 'handoff').out, /ds shape folds 2 fixup! commits$/)
  ds(cwd, 'shape')
  assert.match(ds(cwd, 'handoff').out, /\nnext: \/dossier:ship — land demo$/)
  const sha = pushed(cwd)
  assert.match(ds(cwd, 'handoff').out, /\nnext: ds ci$/)
  gh(['[{"databaseId":1,"name":"ci","status":"completed","conclusion":"failure","url":"https://x/1"}]'])
  assert.equal(ds(cwd, 'ci').code, 1)
  assert.match(ds(cwd, 'handoff').out, /\nci: https:\/\/x\/1$/)
  gh(['[{"databaseId":2,"name":"ci","status":"completed","conclusion":"success","url":"https://x/2"}]'])
  assert.equal(ds(cwd, 'ci').out, `CI: OK, 1 runs for ${sha.slice(0, 7)}`)
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR\nclose: /dossier:close "<one line>"')
  sh(cwd, `git update-ref -d refs/remotes/origin/demo`)
  assert.match(ds(cwd, 'handoff').out, /close: /, 'a pruned remote branch after the merge still reads as shipped')
  ds(cwd, 'add', 'Sign the release', '--who', 'H')
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR\noperator: O101 Sign the release')
  ds(cwd, 'set', 'O101', 'done', 'signed')
  sh(cwd, 'echo y > src/b.ts && git commit -qam "fix(b): one more"')
  assert.match(ds(cwd, 'handoff').out, /review the branch$/)
})

test('a branch that lands on the base by fast-forward goes to CI and close with no pull request', () => {
  const cwd = repo()
  const path = built(cwd)
  review(cwd, path, 'PASS')
  ds(cwd, 'shape')
  assert.match(ds(cwd, 'handoff').out, /\nnext: \/dossier:ship — land demo$/)
  const bare = join(mkdtempSync(join(tmpdir(), 'ds-remote-')), 'acme', 'demo.git')
  sh(cwd, `git init -q --bare ${bare} && git remote add origin ${bare} && git push -q origin main`)
  assert.match(ds(cwd, 'ci').err, /demo is not pushed/)
  sh(cwd, 'git switch -q main && git merge -q --ff-only demo && git push -q origin main && git switch -q demo')
  assert.match(ds(cwd, 'handoff').out, /\nnext: ds ci$/)
  const sha = sh(cwd, 'git rev-parse demo')
  const dir = gh(['[{"databaseId":2,"name":"ci","status":"completed","conclusion":"success","url":"https://x/2"}]'])
  assert.equal(ds(cwd, 'ci').out, `CI: OK, 1 runs for ${sha.slice(0, 7)}`)
  assert.match(file(join(dir, 'calls')), new RegExp(`--commit ${sha} `))
  assert.match(ds(cwd, 'handoff').out, /close: \/dossier:close/)
})

test('a branch that the ship tool renamed is followed: the header takes the public name', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, file(path).replace('branch: demo', 'branch: feat/cc-abc123-demo'))
  ds(cwd, 'new', 'other')
  assert.equal(ds(cwd, 'lint', '--dossier', 'demo').out, 'LINT: OK')
  assert.match(file(path), /^branch: feat\/cc-abc123-demo$/m, 'no branch yet: the header stays')
  sh(cwd, 'git switch -qc feat/cc-abc123-demo')
  assert.equal(ds(cwd, 'path').out, dirname(path))
  assert.match(file(path), /^branch: feat\/cc-abc123-demo$/m, 'the branch exists: the header stays')
  sh(cwd, 'git branch -m feat/cc-abc123-demo feat/demo')
  assert.equal(ds(cwd, 'path').out, dirname(path), 'two live dossiers, and the renamed one is still found by its branch')
  assert.match(file(path), /^branch: feat\/demo$/m)
  assert.match(file(join(dirname(path), 'worklog.md')), /branch feat\/cc-abc123-demo -> feat\/demo$/m)
})

test('ds ci waits for running runs, asks gh for the pushed commit, and names each failure', () => {
  const cwd = repo()
  built(cwd)
  const sha = pushed(cwd)
  const dir = gh([
    '[]',
    '[{"databaseId":1,"name":"lint","status":"in_progress","conclusion":"","url":"https://x/1"},{"databaseId":2,"name":"test","status":"queued","conclusion":"","url":"https://x/2"}]',
    '[{"databaseId":1,"name":"lint","status":"completed","conclusion":"skipped","url":"https://x/1"},{"databaseId":2,"name":"test","status":"completed","conclusion":"cancelled","url":"https://x/2"}]',
  ])
  process.env.DS_CI_APPEAR = '0.3'
  process.env.DS_CI_POLL = '0.05'
  const done = ds(cwd, 'ci')
  assert.equal(done.code, 1)
  assert.equal(done.err, 'ds ci: FAIL\ntest cancelled https://x/2')
  const calls = file(join(dir, 'calls')).trim().split('\n')
  assert.ok(calls.length > 3, 'a finished list is read again until the window ends')
  assert.equal(calls[0], `run list --repo acme/demo --commit ${sha} --json databaseId,name,status,conclusion,url`)
})

test('ds ci reports no run, a missing push, a gh failure and a run past the limit', () => {
  const cwd = repo()
  const path = built(cwd)
  review(cwd, path, 'PASS')
  ds(cwd, 'shape')
  assert.match(ds(cwd, 'ci').err, /demo is not pushed/)
  const sha = pushed(cwd)
  gh(['[]'])
  assert.equal(ds(cwd, 'ci').out, `CI: NONE, no run for ${sha.slice(0, 7)} after 0 s`)
  assert.match(ds(cwd, 'handoff').out, /close: \/dossier:close/)
  sh(cwd, 'echo y > src/b.ts && git commit -qam "fix(b): one more"')
  assert.match(ds(cwd, 'ci').err, /commits that are not pushed/)
  sh(cwd, 'git push -q origin demo')
  gh(['boom'], 1)
  const failed = ds(cwd, 'ci')
  assert.equal(failed.code, 2)
  assert.match(failed.err, /^ds ci: gh failed/)
  gh(['[{"databaseId":3,"name":"ci","status":"in_progress","conclusion":"","url":"https://x/3"}]'])
  process.env.DS_CI_LIMIT = '0'
  process.env.DS_NOW = '2026-11-14 09:15'
  review(cwd, path, 'PASS')
  const slow = ds(cwd, 'ci')
  assert.equal(slow.code, 3)
  assert.match(slow.err, /still running/)
  assert.match(ds(cwd, 'handoff').out, /\nnext: ds ci — started 2026-11-14 09:15 UTC; run it again if it stopped$/)
  process.env.DS_CI_LIMIT = 'soon'
  gh(['[]'])
  assert.match(ds(cwd, 'ci').out, /^CI: NONE/, 'a bad number falls back to the default, not a loop')
})
