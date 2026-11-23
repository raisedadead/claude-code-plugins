import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { checkedPlan, ds, file, planned, recordReview, repo, sh } from './kit.ts'

function build(cwd: string, path: string, subject: string, body = 'x'): void {
  mkdirSync(dirname(join(cwd, path)), { recursive: true })
  writeFileSync(join(cwd, path), `${body}\n`)
  sh(cwd, `git add ${path} && git commit -qm "fixup! ${subject}"`)
}

test('a dossier runs from plan to close with commands only', () => {
  const cwd = repo()
  checkedPlan(cwd)
  assert.equal(ds(cwd, 'anchors').code, 0)
  assert.equal(sh(cwd, 'git log --format=%s main..HEAD'), 'feat(c): add the c module\nfeat(b): add the b module')
  assert.equal(ds(cwd, 'next').out, '- O1 next A Add the b module')
  const mission = ds(cwd, 'mission', 'O1').out
  assert.match(file(mission), /git commit -m "fixup! feat\(b\): add the b module"/)
  assert.match(file(mission), /Row: - O1 now A/)
  assert.match(file(mission), /Keep it short\./)
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  assert.equal(ds(cwd, 'verify', 'O1').code, 0)
  assert.match(ds(cwd, 'done', 'O1').out, /^- O1 done A Add the b module · [0-9a-f]{7}$/)
  ds(cwd, 'mission', 'O2')
  build(cwd, 'lib/c.ts', 'feat(c): add the c module')
  assert.equal(ds(cwd, 'verify', 'O2').code, 0)
  ds(cwd, 'done', 'O2')
  const next = ds(cwd, 'next')
  assert.equal(next.code, 3)
  assert.match(next.err, /O3 wait H Approve the PR/)
  assert.equal(ds(cwd, 'check').code, 0)
  const pack = ds(cwd, 'pack', 'review').out
  assert.match(file(pack), /\+x/)
  assert.doesNotMatch(file(pack), /## Plan check findings|## Rulings/)
  recordReview(cwd, 'PASS')
  const tree = sh(cwd, 'git rev-parse HEAD^{tree}')
  assert.equal(ds(cwd, 'shape').code, 0)
  assert.equal(sh(cwd, 'git rev-parse HEAD^{tree}'), tree)
  assert.equal(sh(cwd, 'git log --format=%s%b main..HEAD'), 'feat(c): add the c module\nfeat(b): add the b module')
  assert.match(ds(cwd, 'shape').out, /already shaped/)
  sh(cwd, 'git remote add origin git@github.com:me/demo.git')
  const top = sh(cwd, 'git rev-parse --show-toplevel')
  assert.deepEqual(JSON.parse(ds(cwd, 'ship-args').out), { repo: top, branch: 'demo', base: 'main', title: 'feat(b): add the b module' })
  const closed = ds(cwd, 'close', 'built b and c')
  assert.equal(closed.code, 0, closed.err)
  assert.ok(existsSync(join(cwd, '.scratchpad/dossier/_archive/2026-11-14-demo/DOSSIER.md')))
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /^- O3 wait H Approve the PR$/m)
  assert.match(closed.out, /O3 Approve the PR/)
})

test('anchors wait for a baseline and a passing plan check of the current text', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.match(ds(cwd, 'anchors').err, /check --baseline/)
  const findings = join(dirname(path), 'f.md')
  file(findings, 'VERDICT: PASS\n')
  for (const step of [
    ['check', '--baseline'],
    ['pack', 'plan'],
    ['record', 'plan', findings],
  ])
    assert.equal(ds(cwd, ...step).code, 0)
  file(path, file(path).replace('"add b"', '"add b now"'))
  ds(cwd, 'check', '--baseline')
  assert.match(ds(cwd, 'anchors').err, /not checked for its current text/)
})

test('a baseline fails when a check already passes, and passes when a guard fails nothing', () => {
  const cwd = repo()
  planned(cwd)
  writeFileSync(join(cwd, 'src/b.ts'), 'x\n')
  const done = ds(cwd, 'check', '--baseline')
  assert.equal(done.code, 1)
  assert.match(done.err, /FAIL b-exists: exit 0, want anything but exit 0/)
})

const FINDINGS = [
  'pack-plan.md:44 (b-exists) vs :59: block: the check passes on an empty file. Fix: grep for the export.',
  'Checks c-exists: block: lib is not in Scope. Fix: add it.',
  'Notes O1: note: the note says short. The block: label here is prose.',
  'src/a.ts:1: note: a is exported twice.',
  'docs: note: no doc names b.',
  'VERDICT: CHANGES',
  '',
].join('\n')

const RULINGS = [
  '- block 1: fixed: `grep -q export src/b.ts` exits 1 on an empty sample',
  '- block 2: refused: Scope line 2 names lib/',
  '- note 1: dropped: a matter of wording',
  '- note 2: taken: the export is what ships',
  '- note 3: row O3',
  '',
].join('\n')

function changes(cwd: string): { path: string; findings: string; rulings: string } {
  const path = planned(cwd)
  const findings = join(dirname(path), 'f.md')
  const rulings = join(dirname(path), 'r.md')
  file(findings, FINDINGS)
  ds(cwd, 'check', '--baseline')
  ds(cwd, 'pack', 'plan')
  return { path, findings, rulings }
}

test('a CHANGES verdict asks for a ruling on each finding, and a second record is one more check, not a stop', () => {
  const cwd = repo()
  const { path, findings } = changes(cwd)
  const first = ds(cwd, 'record', 'plan', findings)
  assert.equal(first.code, 1)
  assert.match(first.err, /PLAN CHECK: CHANGES, 2 block and 3 note lines\. Rule on each one, then run ds amend <rulings file>/)
  assert.match(
    first.err,
    /\nblock 1: pack-plan\.md:44 .*\nblock 2: Checks c-exists: .*\nnote 1: Notes O1: .*\nnote 2: .*\nnote 3: docs: note: no doc names b\.$/,
  )
  assert.equal(file(join(dirname(path), 'checked-plan.md')), file(path))
  assert.equal(ds(cwd, 'record', 'plan', findings).code, 1)
  file(findings, 'no verdict here\n')
  assert.match(ds(cwd, 'record', 'plan', findings).err, /no line VERDICT/)
})

test('a finding line can start with a list marker or a bold label, and a CHANGES file with no finding line is refused', () => {
  const cwd = repo()
  const { path, findings, rulings } = changes(cwd)
  file(findings, '- block: one\n1. **note**: two\n**block:** three\n  * src/a.ts:1: note: four\nThe note: five is prose.\nVERDICT: CHANGES\n')
  assert.match(ds(cwd, 'record', 'plan', findings).err, /PLAN CHECK: CHANGES, 2 block and 2 note lines\./)
  file(findings, 'The plan has faults.\nVERDICT: CHANGES\n')
  file(rulings, '\n')
  assert.match(ds(cwd, 'amend', rulings).err, /has no block: or note: line; run ds pack plan and a fresh plan check/)
  const log = join(dirname(path), 'worklog.md')
  const before = file(log)
  const none = ds(cwd, 'record', 'plan', findings)
  assert.equal(none.code, 1)
  assert.match(none.err, /says CHANGES and has no block: or note: line/)
  assert.equal(file(log), before)
})

test('amend takes a ruling for each finding and then stamps the plan', () => {
  const cwd = repo()
  const { path, findings, rulings } = changes(cwd)
  assert.equal(ds(cwd, 'amend').code, 2)
  file(rulings, RULINGS)
  assert.match(ds(cwd, 'amend', rulings).err, /no plan check yet/)
  ds(cwd, 'record', 'plan', findings)
  file(
    rulings,
    RULINGS.replace('- block 2: refused: Scope line 2 names lib/\n', '').replace('row O3', 'row O77').replace('taken: the export is what ships', 'taken'),
  )
  const short = ds(cwd, 'amend', rulings)
  assert.equal(short.code, 1)
  assert.match(short.err, /no ruling for: block 2, note 2, note 3\./)
  assert.match(short.err, /block <n>: fixed\|refused: <what shows it>/)
  file(rulings, RULINGS)
  const done = ds(cwd, 'amend', rulings)
  assert.equal(done.code, 0, done.err)
  assert.match(done.out, /^PLAN: amended [0-9a-f]{12}$/)
  assert.match(file(path), /^checked: [0-9a-f]{12}$/m)
  assert.match(file(join(dirname(path), 'rulings.md')), /block 2: refused: Scope line 2 names lib\//)
  assert.match(ds(cwd, 'amend', rulings).out, /nothing to amend/)
  assert.equal(ds(cwd, 'anchors').code, 0)
  const pack = file(ds(cwd, 'pack', 'review').out)
  assert.match(pack, /## Plan check findings\n\n- block 1: pack-plan\.md:44 .*\n- block 2: .*\n- note 1: /)
  assert.match(pack, /## Rulings on the findings\n[\s\S]*block 2: refused: Scope line 2 names lib\//)
})

test('amend wants a clean lint, a baseline of the current text, and the Goal and Scope that the checker read', () => {
  const cwd = repo()
  const { path, findings, rulings } = changes(cwd)
  ds(cwd, 'record', 'plan', findings)
  file(rulings, RULINGS)
  file(path, file(path).replace('| b-exists | `test -f src/b.ts`', '| b-exists | `grep -q export src/b.ts`'))
  assert.match(ds(cwd, 'amend', rulings).err, /run ds check --baseline on this plan first/)
  ds(cwd, 'check', '--baseline')
  file(path, file(path).replace('## Commits', '## Commitz'))
  assert.match(ds(cwd, 'amend', rulings).err, /run ds lint first/)
  file(path, file(path).replace('## Commitz', '## Commits').replace('- out: everything else', '- out: nothing'))
  ds(cwd, 'check', '--baseline')
  assert.match(ds(cwd, 'amend', rulings).err, /the Scope changed since the plan check; run ds pack plan and a fresh plan check/)
  file(path, file(path).replace('- out: nothing', '- out: everything else'))
  ds(cwd, 'check', '--baseline')
  sh(cwd, `rm ${findings}`)
  assert.match(ds(cwd, 'amend', rulings).err, /the findings file .* is gone/)
  file(findings, FINDINGS)
  assert.equal(ds(cwd, 'amend', rulings).code, 0)
})

test('amend reads a findings path of an older worklog from the main checkout, and refuses a plan with no kept text', () => {
  const cwd = repo()
  const { path, findings, rulings } = changes(cwd)
  ds(cwd, 'record', 'plan', findings)
  file(rulings, RULINGS)
  const log = join(dirname(path), 'worklog.md')
  file(log, file(log).replace(findings, '.scratchpad/dossier/2026-11-14-demo/f.md'))
  const lane = join(dirname(cwd), 'lane')
  sh(cwd, `git worktree add -q -b other ${lane} main`)
  sh(cwd, `rm ${join(dirname(path), 'checked-plan.md')}`)
  assert.match(ds(lane, 'amend', rulings, '--dossier', 'demo').err, /checked before ds kept the checked text/)
  file(join(dirname(path), 'checked-plan.md'), file(path))
  const done = ds(lane, 'amend', rulings, '--dossier', 'demo')
  assert.equal(done.code, 0, done.err)
})

test('after a PASS, an edit of the plan is amended with a note of what changed', () => {
  const cwd = repo()
  const path = checkedPlan(cwd)
  const notes = join(dirname(path), 'n.md')
  file(path, file(path).replace('| b-exists | `test -f src/b.ts`', '| b-exists | `test -s src/b.ts`'))
  ds(cwd, 'check', '--baseline')
  file(notes, '\n')
  assert.match(ds(cwd, 'amend', notes).err, /say what changed and why/)
  file(notes, 'b-exists now wants a file that is not empty\n')
  assert.equal(ds(cwd, 'amend', notes).code, 0)
  assert.equal(ds(cwd, 'anchors').code, 0)
})

test('verify refuses work outside the planned paths, a stray commit and uncommitted changes', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  assert.equal(ds(cwd, 'verify', 'O1').code, 0)
  build(cwd, 'src/other.ts', 'feat(b): add the b module')
  assert.match(ds(cwd, 'verify', 'O1').err, /changes src\/other.ts, outside the paths/)
  sh(cwd, 'git reset -q --hard HEAD~1 && echo y > src/b.ts && git commit -qam "wip"')
  assert.match(ds(cwd, 'verify', 'O1').err, /"wip" is not a planned commit/)
  sh(cwd, 'git reset -q --hard HEAD~1 && echo z > src/b.ts')
  assert.match(ds(cwd, 'verify', 'O1').err, /uncommitted changes/)
  assert.match(ds(cwd, 'done', 'O1').err, /run ds verify O1 first/)
  assert.match(ds(cwd, 'done', 'O3', '--cite', 'approved').out, /O3 done H Approve the PR · approved/)
})

test('shape refuses a planned commit with no work and a commit that is not planned', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  assert.match(ds(cwd, 'shape').err, /"feat\(c\): add the c module" has no work/)
  build(cwd, 'lib/c.ts', 'feat(c): add the c module')
  sh(cwd, 'echo q > src/q.ts && git add src/q.ts && git commit -qm "chore: stray"')
  assert.match(ds(cwd, 'shape').err, /"chore: stray" is not a planned commit/)
})

test('shape leaves pushed commits alone and refuses a fixup of one', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  build(cwd, 'lib/c.ts', 'feat(c): add the c module')
  assert.equal(ds(cwd, 'shape').code, 0)
  const remote = join(dirname(cwd), 'remote.git')
  sh(cwd, `git init -q --bare ${remote} && git remote add origin ${remote} && git push -q origin demo`)
  build(cwd, 'src/b.ts', 'feat(b): add the b module', 'y')
  assert.match(ds(cwd, 'shape').err, /already pushed/)
})

test('lanes split planned commits by paths and integrate brings a lane back', () => {
  const cwd = repo()
  const path = checkedPlan(cwd)
  assert.equal(ds(cwd, 'lanes').out, 'demo-lane-1:\n- feat(b): add the b module (O1)\ndemo-lane-2:\n- feat(c): add the c module (O2)')
  file(path, file(path).replace('| O2 | lib/** |', '| O2 | src/** |'))
  assert.equal(ds(cwd, 'lanes').out.split('\n')[0], 'demo-lane-1:')
  assert.equal(ds(cwd, 'lanes').out.split('\n').length, 3)
  file(path, file(path).replace('| O2 | src/** |', '| O2 | lib/** |'))
  ds(cwd, 'anchors')
  const lane = join(dirname(cwd), 'lane')
  sh(cwd, `git worktree add -q -b demo-lane-2 ${lane} demo`)
  build(lane, 'lib/c.ts', 'feat(c): add the c module')
  assert.equal(ds(lane, 'verify', 'O2').code, 0)
  build(cwd, 'src/b.ts', 'feat(b): add the b module')
  const done = ds(cwd, 'integrate', 'demo-lane-2')
  assert.equal(done.code, 0, done.err)
  assert.equal(sh(cwd, 'git log --format=%s -1'), 'fixup! feat(c): add the c module')
  assert.match(ds(cwd, 'integrate', 'other').err, /usage/)
})

test('close refuses open rows and new picks its next folder name', () => {
  const cwd = repo()
  planned(cwd)
  assert.match(ds(cwd, 'close', 'stop').err, /open rows/)
  assert.match(ds(cwd, 'new', 'demo', '--dossier', 'x').out, /2026-11-14-demo-2/)
  assert.match(ds(cwd, 'next').err, /more than one live dossier/)
  assert.equal(ds(cwd, 'next', '--dossier', 'demo').out, '- O1 next A Add the b module')
  assert.match(ds(cwd, 'new', 'Bad Slug').err, /usage/)
})

test('a baseline runs a check on its sample: the check must pass there, and a guard must fail there', () => {
  const cwd = repo()
  const path = planned(cwd)
  const samples = join(dirname(path), 'samples')
  file(join(samples, 'b-exists', 'src', 'b.ts'), 'x\n')
  const proved = ds(cwd, 'check', '--baseline')
  assert.equal(proved.code, 0, proved.err)
  assert.match(proved.out, /OK b-exists: exit 1, want anything but exit 0; sample: exit 0, want exit 0/)
  assert.match(proved.out, /OK c-exists: exit 1, want anything but exit 0; no sample/)
  file(join(samples, 'c-exists', 'lib', 'c.txt'), 'x\n')
  const never = ds(cwd, 'check', '--baseline')
  assert.equal(never.code, 1)
  assert.match(never.err, /FAIL c-exists: exit 1, want anything but exit 0; sample: exit 1, want exit 0/)
  file(join(samples, 'c-exists', 'lib', 'c.ts'), 'x\n')
  file(join(samples, 'a-kept', 'src', 'a.ts'), 'export const a = 1\n')
  const blind = ds(cwd, 'check', '--baseline')
  assert.equal(blind.code, 1)
  assert.match(blind.err, /FAIL a-kept \(guard\): exit 0, want exit 0; sample: exit 0, want anything but exit 0/)
  file(join(samples, 'a-kept', 'src', 'a.ts'), 'export const b = 1\n')
  assert.equal(ds(cwd, 'check', '--baseline').code, 0)
  assert.doesNotMatch(ds(cwd, 'check').out, /sample/)
})

test('a sample run does not read the repository around it', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, file(path).replace('| a-kept |', '| in-git | `git rev-parse --show-toplevel` | exit 0 | no | O2 |\n| a-kept |'))
  file(join(dirname(path), 'samples', 'in-git', 'keep'), '')
  const done = ds(cwd, 'check', '--baseline')
  assert.match(done.err, /FAIL in-git: exit 0, want anything but exit 0; sample: exit 128, want exit 0/)
})
