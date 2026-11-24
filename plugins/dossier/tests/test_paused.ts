import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, file, repo } from './kit.ts'

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
