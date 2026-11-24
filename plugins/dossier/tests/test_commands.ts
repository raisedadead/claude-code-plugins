import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { test } from 'vitest'
import { reviews, reviewsFile, worktreeOf } from '../engine/branch.ts'
import { checkedPlan, ds, file, planned, repo, sh } from './kit.ts'

const HOST_REFUSES = /^(report|summary|findings|analysis).*\.md$/i

test('log, path and lint report on the live dossier', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'path').out, dirname(path))
  assert.equal(ds(cwd, 'log', 'asked', 'the', 'operator').out, 'logged')
  assert.match(file(join(dirname(path), 'worklog.md')), /note asked the operator$/m)
  assert.equal(ds(cwd, 'log').code, 2)
  assert.equal(ds(cwd, 'lint').out, 'LINT: OK')
  file(path, file(path).replace('pr: feat(b): add the b module', 'pr: '))
  assert.match(ds(cwd, 'lint').err, /LINT: 1 problems\nheader: pr/)
})

test('the plan pack holds each cited line, and names a missing file', () => {
  const cwd = repo()
  const path = planned(cwd)
  sh(cwd, 'mkdir -p lib && echo o > lib/old.ts && git add . && git commit -qm "chore: old"')
  file(path, file(path).replace('- out: everything else', '- out: everything else, see src/a.ts:1 and gone/x.ts:3'))
  ds(cwd, 'check', '--baseline')
  const pack = file(ds(cwd, 'pack', 'plan').out)
  assert.match(pack, /### src\/a.ts:1\n\n```\nexport const a = 1\n```/)
  assert.match(pack, /### gone\/x.ts:3\n\n\(no such file\)/)
  assert.match(pack, /## Files in the planned paths\n\n- lib\/old.ts$/m)
  assert.match(ds(cwd, 'record', 'plan').err, /usage/)
})

test('the plan pack names the file of the plan checker, with a name the host lets a helper write and a new number after each recorded check', () => {
  const cwd = repo()
  const path = planned(cwd)
  ds(cwd, 'check', '--baseline')
  const first = join(dirname(path), 'plan-check-1.md')
  const named = (): string => /^Plan checker: write your findings to this file: (.+)$/m.exec(file(ds(cwd, 'pack', 'plan').out))?.[1] ?? ''
  assert.equal(named(), first)
  assert.equal(named(), first, 'a second pack with no record keeps the number')
  file(first, 'Checks: block: x\nVERDICT: CHANGES\n')
  assert.equal(ds(cwd, 'record', 'plan', first).code, 1)
  assert.equal(named(), join(dirname(path), 'plan-check-2.md'))
  assert.doesNotMatch(basename(named()), HOST_REFUSES)
})

test('ship-args names the worktree that holds the dossier branch, as the ship tool wants it', () => {
  const cwd = repo()
  checkedPlan(cwd)
  const lane = join(dirname(cwd), 'built')
  sh(cwd, `git worktree add -q -b demo ${lane} main`)
  const args = JSON.parse(ds(cwd, 'ship-args').out)
  assert.equal(args.repo, sh(lane, 'git rev-parse --show-toplevel'))
  assert.match(args.repo, /^\//)
  assert.deepEqual(Object.keys(args), ['repo', 'branch', 'base', 'title'])
})

test('lanes print as JSON with their branch names', () => {
  const cwd = repo()
  checkedPlan(cwd)
  const lanes = JSON.parse(ds(cwd, 'lanes', '--json').out)
  assert.deepEqual(
    lanes.map((l: { lane: string }) => l.lane),
    ['demo-lane-1', 'demo-lane-2'],
  )
})

test('integrate stops on a conflict and names the path', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  const lane = join(dirname(cwd), 'lane')
  sh(cwd, `git worktree add -q -b demo-lane-2 ${lane} demo`)
  file(join(lane, 'lib/c.ts'), 'lane\n')
  sh(lane, 'git add . && git commit -qm "fixup! feat(c): add the c module"')
  file(join(cwd, 'lib/c.ts'), 'main\n')
  sh(cwd, 'git add . && git commit -qm "fixup! feat(b): add the b module"')
  const done = ds(cwd, 'integrate', 'demo-lane-2')
  assert.equal(done.code, 1)
  assert.match(done.err, /CONFLICT in .*lane:\nlib\/c.ts/)
  assert.match(ds(cwd, 'integrate', 'demo-lane-9').err, /must be checked out/)
  assert.equal(worktreeOf(cwd, 'nope'), undefined)
})

test('integrate leaves a pushed lane alone, and fast-forwards a lane already on top', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  const lane = join(dirname(cwd), 'lane')
  sh(cwd, `git worktree add -q -b demo-lane-2 ${lane} demo`)
  file(join(lane, 'lib/c.ts'), 'lane\n')
  sh(lane, 'git add . && git commit -qm "fixup! feat(c): add the c module"')
  const remote = join(dirname(cwd), 'remote.git')
  sh(cwd, `git init -q --bare ${remote} && git remote add origin ${remote} && git push -q origin demo-lane-2`)
  const ahead = ds(cwd, 'integrate', 'demo-lane-2')
  assert.equal(ahead.code, 0, ahead.err)
  file(join(cwd, 'src/b.ts'), 'b\n')
  sh(cwd, 'git add . && git commit -qm "fixup! feat(b): add the b module"')
  file(join(lane, 'lib/d.ts'), 'd\n')
  sh(lane, 'git add . && git commit -qm "fixup! feat(c): add the c module" && git push -q origin demo-lane-2')
  const refused = ds(cwd, 'integrate', 'demo-lane-2')
  assert.equal(refused.code, 1)
  assert.match(refused.err, /demo-lane-2 has pushed commits that a rebase would rewrite/)
})

test('close carries the notes of moved rows and refuses an archive name that is taken', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(
    path,
    file(path)
      .replace(
        '- O1 next A Add the b module\n- O2 next A Add the c module',
        '- O1 drop A Add the b module · not needed\n- O2 drop A Add the c module · not needed',
      )
      .replace('### O1\nKeep it short.', '### O3\nAsk on Monday.'),
  )
  mkdirSync(join(cwd, '.scratchpad/dossier/_archive/2026-11-14-demo'), { recursive: true })
  assert.match(ds(cwd, 'close', 'stopped').err, /already exists/)
  const other = repo()
  const second = planned(other)
  file(second, file(path))
  assert.equal(ds(other, 'close', 'stopped').code, 0)
  assert.match(file(join(other, '.scratchpad/OPEN-WORK.md')), /## Notes\n\n### O3\nAsk on Monday\./)
})

test('a broken line in the review record is skipped', () => {
  const cwd = repo()
  appendFileSync(reviewsFile(cwd), 'not json\n{"branch":"x"}\n')
  assert.deepEqual(
    reviews(cwd).map((r) => r.branch),
    ['x'],
  )
})

test('shape stops on a conflict between fixups that it reorders', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  file(join(cwd, 'lib/c.ts'), 'c\n')
  file(join(cwd, 'src/b.ts'), 'c\n')
  sh(cwd, 'git add . && git commit -qm "fixup! feat(c): add the c module"')
  file(join(cwd, 'src/b.ts'), 'b\n')
  sh(cwd, 'git add . && git commit -qm "fixup! feat(b): add the b module"')
  const done = ds(cwd, 'shape')
  assert.equal(done.code, 1)
  assert.match(done.err, /CONFLICT:\nsrc\/b.ts/)
  sh(cwd, 'git rebase --abort')
})

test('shape restores the history when a shaped commit has a body', () => {
  const cwd = repo()
  checkedPlan(cwd)
  sh(
    cwd,
    'git switch -qc demo && git commit -q --allow-empty -m "feat(b): add the b module" -m "a body" && git commit -q --allow-empty -m "feat(c): add the c module"',
  )
  file(join(cwd, 'src/b.ts'), 'b\n')
  file(join(cwd, 'lib/c.ts'), 'c\n')
  sh(cwd, 'git add src && git commit -qm "fixup! feat(b): add the b module" && git add lib && git commit -qm "fixup! feat(c): add the c module"')
  const head = sh(cwd, 'git rev-parse HEAD')
  const done = ds(cwd, 'shape')
  assert.match(done.err, /SHAPE: refused, history restored\n"feat\(b\): add the b module" has a body/)
  assert.equal(sh(cwd, 'git rev-parse HEAD'), head)
})

test('the command line entry prints help to stdout and an unknown command to stderr', async () => {
  const { main } = await import('../cli/dispatch.ts')
  assert.equal(main(['help'], '/'), 0)
  assert.equal(main(['nope'], '/'), 2)
})

test('set --who changes who a row waits on (I5)', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), '# Open work\n\n## Rows\n\n- O7 next A t\n')
  assert.equal(ds(cwd, 'set', 'O7', 'wait', 'paused: x', '--who', 'H').out, '- O7 wait H t · paused: x')
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /^- O7 wait H t · paused: x$/m)
  assert.equal(ds(cwd, 'set', 'O7', 'wait', '--who', 'Z').code, 2)
})

test('close sets the dossier row to done in the register (I6)', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, PLAN_NO_OPEN(file(path)).replace(/^state:/m, 'row: O100\nstate:'))
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /^- O100 next A dossier /m)
  const closed = ds(cwd, 'close', 'all built')
  assert.equal(closed.code, 0, closed.err)
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /^- O100 done A dossier 2026-11-14-demo · all built$/m)
})

test('close leaves the register alone for a dossier with no row key', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, PLAN_NO_OPEN(file(path)))
  assert.equal(ds(cwd, 'close', 'all built').code, 0)
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /^- O100 next A dossier 2026-11-14-demo$/m)
})

function PLAN_NO_OPEN(text: string): string {
  return text
    .replace('- O1 next A Add the b module\n- O2 next A Add the c module', '- O1 drop A Add the b module · x\n- O2 drop A Add the c module · x')
    .replace(/^row: .*\n/m, '')
}
