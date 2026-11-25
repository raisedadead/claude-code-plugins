import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { checkedPlan, ds, file, repo } from './kit.ts'

const REGISTER = `# Open work

## Rows

- O7 wait H Ask about X · paused: back after the incident
- O8 wait H Approve the deploy
- O9 wait H Rename it · pausedness is not a pause
- O10 wait H Hold it · Paused

## Notes
`

test('triage lists paused wait rows under Paused, and only those', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), REGISTER)
  const out = ds(cwd, 'triage').out
  const [waits, paused] = out.split('Paused:')
  assert.ok(paused !== undefined, out)
  assert.match(waits ?? '', /Waits on the operator:/)
  assert.match(waits ?? '', /O8 /)
  assert.match(waits ?? '', /O9 /)
  assert.doesNotMatch(waits ?? '', /O7|O10/)
  assert.match(paused, /O7 Ask about X \(OPEN-WORK.md; paused: back after the incident\)/)
  assert.match(paused, /O10 /)
  assert.doesNotMatch(paused, /O8|O9/)
})

test('triage --json lists paused rows apart from the rows that wait on the operator', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), REGISTER)
  const json = JSON.parse(ds(cwd, 'triage', '--json').out)
  const ids = (flags: { id: string }[]): string[] => flags.map((f) => f.id)
  assert.deepEqual(ids(json.wait), ['O8', 'O9'])
  assert.deepEqual(ids(json.paused), ['O7', 'O10'])
  assert.equal(json.paused[0].why, 'paused: back after the incident')
})

test('handoff names no paused row as an operator step', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O3', 'wait', 'paused: back after the incident', '--who', 'H')
  ds(cwd, 'set', 'O2', 'wait', 'pausedness is not a pause')
  assert.equal(ds(cwd, 'handoff').out, 'operator: O2 Add the c module · pausedness is not a pause\nnext: /dossier:build')
})

test('next lists no paused row among the rows that wait on the operator', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O1', 'wait', 'after O9')
  ds(cwd, 'set', 'O2', 'wait', 'Paused')
  const held = ds(cwd, 'next')
  assert.equal(held.code, 3)
  assert.match(held.err, /- O1 wait A Add the b module · after O9/)
  assert.match(held.err, /- O3 wait H Approve the PR/)
  assert.doesNotMatch(held.err, /O2/)
})

test('when every open row is paused, next points at the ship and handoff names no operator step', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O1', 'wait', 'paused: a')
  ds(cwd, 'set', 'O2', 'wait', 'paused: b')
  ds(cwd, 'set', 'O3', 'wait', 'paused: c', '--who', 'H')
  const held = ds(cwd, 'next')
  assert.equal(held.code, 4)
  assert.match(held.err, /no open row left/)
  assert.doesNotMatch(ds(cwd, 'handoff').out, /operator:/)
})
