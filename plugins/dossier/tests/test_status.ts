import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { checkedPlan, ds, file, planned, repo, sh } from './kit.ts'

const WAITS = `- O1 done A Add the b module · 1111111
- O2 done A Add the c module · 2222222
- O3 wait H Approve the PR
- O4 wait H Hold it · paused: after the release
- O5 next H Decide the name
- O6 now H Read the spend
- O7 next H Sign off · after O9
`

test('one waits-on-you rule: handoff, next, status and triage name the same rows', () => {
  const cwd = repo()
  const path = checkedPlan(cwd)
  file(path, file(path).replace(/^- O1 next A[\s\S]*?(?=\n## Notes)/m, WAITS))
  ds(cwd, 'log', 'subtract: nothing to cut; took none')
  const want = ['O3', 'O5', 'O6']
  const handoff = ds(cwd, 'handoff').out.split('\n')
  assert.deepEqual(
    handoff.filter((line) => line.startsWith('operator: ')).map((line) => line.split(' ')[1]),
    want,
  )
  const next = ds(cwd, 'next')
  assert.equal(next.code, 3)
  assert.deepEqual(
    (next.err.split('waits on the operator:\n')[1] ?? '')
      .split('waits on other rows:')[0]!
      .split('\n')
      .filter((line) => line.startsWith('- O'))
      .map((line) => line.split(' ')[1]),
    want,
  )
  assert.match(ds(cwd, 'status').out, / · \[H\] 3$/)
  const wait = JSON.parse(ds(cwd, 'triage', '--json').out).wait as { id: string; where: string }[]
  assert.deepEqual(
    wait.filter((flag) => flag.where === 'demo').map((flag) => flag.id),
    want,
  )
})

function snapshot(dir: string): string {
  const out: string[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(`${path} ${statSync(path).mtimeMs} ${readFileSync(path, 'utf8')}`)
    }
  }
  walk(dir)
  return out.join('\n')
}

test('status prints nothing when no dossier is live', () => {
  const cwd = repo()
  assert.deepEqual(ds(cwd, 'status'), { code: 0, out: '', err: '' })
})

const DEMO = 'demo · plan · 0/3 · next O1 · [H] 1'
const used = (cwd: string, session: string): string =>
  (JSON.parse(ds(cwd, 'rows', '--json', '--session', session).out).dossiers as { slug: string; pinned: boolean }[])
    .filter((d) => d.pinned)
    .map((d) => d.slug)
    .join('\n')

test('status prints the stage, the count of done rows, the next agent row and the count of rows that wait on the operator', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'status').out, DEMO)
  file(path, file(path).replace('- O1 next A', '- O1 done A'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 1/3 · next O2 · [H] 1')
  file(path, file(path).replace('- O3 wait H', '- O3 next H'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 1/3 · next O2 · [H] 1', 'an operator row that is next waits on the operator')
  file(path, file(path).replace('- O1 done A', '- O1 next A').replace('- O2 next A', '- O2 now A'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 0/3 · next O2 · [H] 1', 'a row in now comes before an earlier row in next')
  file(path, file(path).replace('- O1 next A', '- O1 later A'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 0/2 · next O2 · [H] 1', 'a later row is not counted')
  file(path, file(path).replace('- O1 later A', '- O1 done A').replace('- O2 now A', '- O2 next A').replace('- O3 next H', '- O3 wait H'))
  file(path, file(path).replace('- O2 next A', '- O2 drop A').replace('- O3 wait H', '- O3 done H'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 2/2')
  file(path, file(path).replace(/^- O\d+ .*\n/gm, ''))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · no rows')
})

test('status with no session puts the dossier of the current branch alone, and lists each live dossier on any other branch', () => {
  const cwd = repo()
  const path = planned(cwd)
  ds(cwd, 'new', 'other')
  assert.equal(ds(cwd, 'status').out, `${DEMO}\nother · plan · no rows`)
  sh(cwd, 'git checkout -q -b demo')
  assert.equal(ds(cwd, 'status').out, DEMO)
  sh(cwd, 'git checkout -q -b demo-lane-2')
  assert.equal(ds(cwd, 'status').out, DEMO, 'a lane branch')
  file(path, file(path).replace('branch: demo', 'branch: feat/cc-abc123-demo'))
  assert.match(ds(cwd, 'status').out, /\nother · plan/, 'a branch that names no dossier')
  sh(cwd, 'git checkout -q -b feat/demo')
  assert.equal(ds(cwd, 'status').out, DEMO, 'the name that a ship gave the branch')
})

test('rows --session pins only the live dossiers that session used, and none for a session that used none', () => {
  const cwd = repo()
  process.env.CLAUDE_CODE_SESSION_ID = 's-one'
  const path = planned(cwd)
  delete process.env.CLAUDE_CODE_SESSION_ID
  const other = ds(cwd, 'new', 'other').out
  sh(cwd, 'git checkout -q -b demo')
  assert.equal(used(cwd, 's-one'), 'demo', 'ds new links the session')
  assert.equal(used(cwd, 's-two'), '', 'a session that used no dossier, also on the branch of one')
  process.env.CLAUDE_CODE_SESSION_ID = 's-two'
  ds(cwd, 'lint', '--dossier', 'other')
  ds(cwd, 'lint', '--dossier', 'other')
  assert.equal(used(cwd, 's-two'), 'other', 'a verb that names a dossier links the session')
  assert.equal(file(join(dirname(other), '.sessions')), 's-two\n', 'two uses give one line')
  assert.equal(ds(cwd, 'set', 'O3', 'done', 'approved').code, 0)
  assert.equal(used(cwd, 's-two'), 'demo\nother', 'ds set on a dossier row links the session')
  assert.equal(file(join(dirname(path), '.sessions')), 's-one\ns-two\n')
  delete process.env.CLAUDE_CODE_SESSION_ID
})

test('a review pack links the session only to a dossier it names or whose branch is checked out', () => {
  const cwd = repo()
  planned(cwd)
  sh(cwd, 'git checkout -q -b unrelated')
  process.env.CLAUDE_CODE_SESSION_ID = 's-three'
  ds(cwd, 'pack', 'review')
  assert.equal(used(cwd, 's-three'), '', 'the only live dossier is not linked to unrelated work')
  ds(cwd, 'pack', 'review', '--dossier', 'demo')
  assert.equal(used(cwd, 's-three'), 'demo', 'a pack that names the dossier')
  process.env.CLAUDE_CODE_SESSION_ID = 's-four'
  process.env.DS_DOSSIER = 'demo'
  ds(cwd, 'pack', 'review')
  delete process.env.DS_DOSSIER
  assert.equal(used(cwd, 's-four'), 'demo', 'a pack with DS_DOSSIER')
  process.env.CLAUDE_CODE_SESSION_ID = 's-five'
  sh(cwd, 'git checkout -q -b demo')
  ds(cwd, 'pack', 'review')
  assert.equal(used(cwd, 's-five'), 'demo', 'a pack on the branch of the dossier')
  process.env.CLAUDE_CODE_SESSION_ID = 's-six'
  sh(cwd, 'git checkout -q -b demo-lane-2')
  ds(cwd, 'pack', 'review')
  assert.equal(used(cwd, 's-six'), 'demo', 'a pack on a lane branch of the dossier')
  delete process.env.CLAUDE_CODE_SESSION_ID
})

test('triage links no session to the dossiers it lists', () => {
  const cwd = repo()
  planned(cwd)
  process.env.CLAUDE_CODE_SESSION_ID = 's-seven'
  assert.equal(ds(cwd, 'triage', '--start').code, 0)
  assert.equal(ds(cwd, 'triage').code, 0)
  assert.equal(used(cwd, 's-seven'), '')
  delete process.env.CLAUDE_CODE_SESSION_ID
})

test('status writes no file, also for a branch that a ship renamed', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, file(path).replace('branch: demo', 'branch: feat/cc-abc123-demo'))
  sh(cwd, 'git branch feat/cc-abc123-demo && git branch -m feat/cc-abc123-demo feat/demo')
  const scratch = join(dirname(dirname(dirname(path))))
  const before = [snapshot(scratch), snapshot(process.env.DS_STATE_DIR ?? ''), sh(cwd, 'git status --porcelain --ignored')]
  assert.equal(ds(cwd, 'status').code, 0)
  assert.deepEqual([snapshot(scratch), snapshot(process.env.DS_STATE_DIR ?? ''), sh(cwd, 'git status --porcelain --ignored')], before)
  assert.match(ds(cwd, 'path').out, /demo$/)
  assert.notDeepEqual(snapshot(scratch), before[0], 'ds path follows the rename, so the fixture does reach the write')
})
