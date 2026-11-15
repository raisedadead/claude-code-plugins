import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { header } from '../engine/plan.ts'
import { takeId } from '../engine/store.ts'
import { checkedPlan, ds, file, planned, repo } from './kit.ts'

test('a new row gets a number above every number in the ledger and the counter', () => {
  const cwd = repo()
  planned(cwd)
  assert.equal(ds(cwd, 'add', 'Next thing').out, '- O101 next A Next thing')
  assert.equal(ds(cwd, 'add', 'Ask the operator', '--who', 'H', '--state', 'wait', '--register').out, '- O102 wait H Ask the operator')
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), /## Rows\n\n- O100 next A dossier 2026-11-14-demo\n- O102 wait H Ask the operator\n/)
  const other = repo()
  assert.equal(ds(other, 'add', 'Elsewhere', '--register').out, '- O1 next A Elsewhere')
})

test('the counter never goes below the highest number in the repo', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), '# Open work\n\n## Rows\n\n- O189 next A Old row\n')
  assert.equal(takeId(cwd), 'O190')
  assert.equal(takeId(cwd), 'O191')
})

test('a held lock stops a second taker', () => {
  const cwd = repo()
  mkdirSync(join(process.env.DS_STATE_DIR ?? '', 'next-id.lock'), { recursive: true })
  process.env.DS_LOCK_MS = '100'
  assert.throws(() => takeId(cwd), /locked/)
  delete process.env.DS_LOCK_MS
})

test('add and set refuse a row out of shape, and set finds rows in the register', () => {
  const cwd = repo()
  assert.match(ds(cwd, 'add', 'Fix', 'T4', 'again', '--register').err, /another ID/)
  assert.match(ds(cwd, 'add', 'Later', '--state', 'later', '--register').err, /needs a tail/)
  for (const empty of [[], ['<title>']]) assert.match(ds(cwd, 'add', ...empty, '--who', 'H', '--register').err, /needs a title/)
  ds(cwd, 'add', 'Later', '--state', 'later', '--tail', 'until 2027-01-01', '--register')
  assert.equal(ds(cwd, 'set', 'O1', 'drop', 'no longer needed').out, '- O1 drop A Later · no longer needed')
  assert.match(ds(cwd, 'set', 'O9', 'done', 'x').err, /no row O9/)
  assert.match(ds(cwd, 'set', 'O1', 'maybe').err, /state must be one of/)
})

test('ds new gives the dossier a register line and a row: key with the same number', () => {
  const cwd = repo()
  const path = ds(cwd, 'new', 'demo').out
  const id = /^row: (O\d+)$/m.exec(file(path))?.[1]
  assert.ok(id, 'DOSSIER.md header has row:')
  assert.match(file(join(cwd, '.scratchpad/OPEN-WORK.md')), new RegExp(`## Rows\\n\\n- ${id} next A dossier 2026-11-14-demo\\n`))
})

test('ds add after ds new takes the next number', () => {
  const cwd = repo()
  const path = ds(cwd, 'new', 'demo').out
  const n = Number(/^row: O(\d+)$/m.exec(file(path))?.[1])
  assert.equal(ds(cwd, 'add', 'More').out, `- O${n + 1} next A More`)
})

test('row: survives ds anchors', () => {
  const cwd = repo()
  const path = checkedPlan(cwd)
  file(path, file(path).replace('row: O100\n', 'row: O77\n'))
  assert.equal(ds(cwd, 'anchors').code, 0)
  assert.equal(header(file(path)).row, 'O77')
})
