import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { LATER_HEAD } from '../engine/triage.ts'
import { ds, file, planned, repo, sh } from './kit.ts'

const REGISTER = `# Open work

## Rows

- O10 wait H Approve the deploy
- O11 later A Re-read the spend · until 2026-11-01
- O12 later A Look at the pane again · until 2027-01-01
- O13 later A Port the view · after model-routing
- O14 later A Retry the PR · after pr me/demo#4
- O15 later A Someday maybe
- O16 next A Plain open work

## Notes
`

test('triage lists waiting rows, due and broken deferred rows, and live dossiers', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), REGISTER)
  planned(cwd)
  const out = ds(cwd, 'triage').out
  assert.match(out, /Waits on the operator:\n- O10 Approve the deploy \(OPEN-WORK.md; waits on the operator\)\n- O3 Approve the PR \(demo;/)
  assert.match(out, /- O11 Re-read the spend \(OPEN-WORK.md; date 2026-11-01 passed\)/)
  assert.match(out, /- O15 Someday maybe \(OPEN-WORK.md; no trigger in the grammar\)/)
  assert.match(out, /Out of shape:\n- line \d+ - O15 later A Someday maybe/)
  assert.doesNotMatch(out, /O12|O13|O14|O16/)
  assert.match(out, /Live dossiers:\n- demo: plan; 2 next, 1 wait; next O1 Add the b module$/)
  mkdirSync(join(cwd, '.scratchpad/dossier/_archive/2026-11-01-model-routing'), { recursive: true })
  assert.match(ds(cwd, 'triage').out, /O13 Port the view \(OPEN-WORK.md; dossier model-routing closed\)/)
})

test('triage flags a row in progress with no recent worklog line, and a plan changed after its check', () => {
  const cwd = repo()
  const path = planned(cwd)
  ds(cwd, 'set', 'O1', 'now')
  assert.doesNotMatch(ds(cwd, 'triage').out, /In progress/)
  process.env.DS_TODAY = '2026-11-20'
  assert.match(ds(cwd, 'triage').out, /In progress with no recent work:\n- O1 Add the b module \(demo; no worklog line since 2026-11-14\)/)
  process.env.DS_TODAY = '2026-11-14'
  file(path, file(path).replace('state: plan', 'state: build'))
  assert.match(ds(cwd, 'triage').out, /the plan changed since its check/)
})

test('triage writes the later view, but never over a hand-written LATER.md', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), REGISTER)
  ds(cwd, 'triage')
  const view = file(join(cwd, '.scratchpad/LATER.md'))
  assert.ok(view.startsWith(LATER_HEAD))
  assert.match(view, /- O12 Look at the pane again · until 2027-01-01/)
  writeFileSync(join(cwd, '.scratchpad/LATER.md'), 'old notes\n')
  ds(cwd, 'triage')
  assert.equal(file(join(cwd, '.scratchpad/LATER.md')), 'old notes\n')
  assert.equal(JSON.parse(ds(cwd, 'triage', '--json').out).wait[0].id, 'O10')
})

test('a quiet repo says so', () => {
  const cwd = repo()
  assert.equal(ds(cwd, 'triage').out, 'Nothing is hanging and no dossier is live.')
  assert.equal(sh(cwd, 'ls .scratchpad'), 'LATER.md')
})
