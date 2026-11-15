import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, file, planned, repo } from './kit.ts'

const rows = (body: string) => `# Open work\n\n## Rows\n\n${body}\n\n## Notes\n`
const NEVER = /Waits on the operator:|Paused:|Live dossiers:/

test('start prints nothing for a wait row only', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), rows('- O10 wait H Approve the deploy'))
  const done = ds(cwd, 'triage', '--start')
  assert.equal(done.out, '')
  assert.equal(done.code, 0)
})

test('start prints a due later row', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), rows('- O10 wait H Approve the deploy\n- O11 later A Re-read the spend · until 2026-11-01'))
  const out = ds(cwd, 'triage', '--start').out
  assert.match(out, /^Deferred and now due:\n- O11 Re-read the spend \(OPEN-WORK.md; date 2026-11-01 passed\)$/)
  assert.doesNotMatch(out, NEVER)
})

test('start names a dossier whose plan changed after its check', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'triage', '--start').out, '')
  file(path, file(path).replace('state: plan', 'state: build'))
  const out = ds(cwd, 'triage', '--start').out
  assert.equal(out, 'Plan changed since its check:\n- demo')
  assert.doesNotMatch(out, NEVER)
})

test('json wins over start', () => {
  const cwd = repo()
  assert.ok(JSON.parse(ds(cwd, 'triage', '--start', '--json').out).wait)
})
