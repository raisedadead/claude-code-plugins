import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { needs, ready } from '../engine/rows.ts'
import { rowStates } from '../engine/triage.ts'
import { checkedPlan, ds, file, planned, repo } from './kit.ts'

const row = (tail: string) => ({ id: 'O9', state: 'wait' as const, who: 'H' as const, title: 'Run it', tail })

test('a row is ready when each row its after tail names is done', () => {
  const states = new Map([
    ['O1', 'done'],
    ['O2', 'next'],
    ['O3', 'drop'],
  ] as const)
  assert.deepEqual(needs(row('')), [])
  assert.deepEqual(needs(row('ds verify failed twice')), [])
  assert.deepEqual(needs(row('after O1, O2')), ['O1', 'O2'])
  assert.deepEqual(needs(row('after O1; the guard line first')), ['O1'])
  assert.equal(ready(row(''), states), true)
  assert.equal(ready(row('after O1'), states), true)
  assert.equal(ready(row('after O1, O2'), states), false, 'one named row is open')
  assert.equal(ready(row('after O3'), states), false, 'a dropped row never makes it ready')
  assert.equal(ready(row('after O7'), states), false, 'a missing row never makes it ready')
  for (const tail of ['after O1 and O2', 'after O1,O2', 'after O1 lands'])
    assert.equal(ready(row(tail), states), false, `a tail that misses the grammar fails closed: ${tail}`)

  const cwd = repo()
  const scratch = join(cwd, '.scratchpad')
  file(
    join(scratch, 'OPEN-WORK.md'),
    '# Open work\n\n## Rows\n\n- O50 done A Carried row · 3f2a9c1\n- O52 wait H Later step · after O51\n- O53 wait A Kept row\n\n## Notes\n',
  )
  const archived = file(
    join(scratch, 'dossier/_archive/2026-11-01-old/DOSSIER.md'),
    '# old\n\nstate: done\n\n## Rows\n\n- O50 wait A Carried row\n- O51 done A Old row · 1a2b3c4\n- O53 done A Kept row · 5d6e7f8\n\n## Notes\n',
  )
  assert.ok(archived)
  const all = rowStates(cwd)
  assert.equal(all.get('O51'), 'done', 'a row of an archived dossier is read')
  assert.equal(all.get('O50'), 'done', 'a done copy wins over an open copy read after it')
  assert.equal(all.get('O53'), 'done', 'a done copy wins over an open copy read before it')
  assert.match(ds(cwd, 'triage').out, /Waits on the operator:\n- O52 Later step/)
})

test('ds next skips an agent row whose after rows are open', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O1', 'next', 'after O2')
  assert.match(ds(cwd, 'next').out, /^- O2 next A /)
  ds(cwd, 'set', 'O2', 'done', '3f2a9c1')
  assert.match(ds(cwd, 'next').out, /^- O1 next A Add the b module · after O2/)
  ds(cwd, 'set', 'O1', 'next', 'after O3')
  const held = ds(cwd, 'next')
  assert.equal(held.code, 3)
  assert.match(held.err, /waits on other rows:\n- O1 next A Add the b module · after O3/)
})

test('handoff names the build while an agent row is ready', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O3', 'wait', 'after O1')
  assert.equal(ds(cwd, 'handoff').out, 'next: /dossier:build', 'an operator row whose rows are open is not handed out')
  ds(cwd, 'set', 'O1', 'done', '3f2a9c1')
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR · after O1\nnext: /dossier:build')
  ds(cwd, 'set', 'O2', 'next', 'after O3')
  assert.equal(ds(cwd, 'handoff').out, 'operator: O3 Approve the PR · after O1', 'an agent row waits on a ready operator row: no next, no blocked')
  ds(cwd, 'set', 'O3', 'wait', 'after O2')
  ds(cwd, 'set', 'O2', 'wait', 'after O3')
  assert.equal(
    ds(cwd, 'handoff').out,
    'blocked: O2 Add the c module · after O3\nblocked: O3 Approve the PR · after O2',
    'rows that only wait on each other: no ship step, the blocked lines',
  )
})

test('status counts only ready operator rows', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 0/3 · next O1 · [H] 1')
  file(path, file(path).replace('- O3 wait H Approve the PR', '- O3 wait H Approve the PR · after O1'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 0/3 · next O1')
  file(path, file(path).replace('- O1 next A Add the b module', '- O1 next A Add the b module · after O2'))
  assert.equal(ds(cwd, 'status').out, 'demo · plan · 0/3 · next O2', 'the next row is the first ready agent row')
})

test('triage lists an operator row that is not ready as blocked', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(
    path,
    file(path)
      .replace('- O3 wait H Approve the PR', '- O3 wait H Approve the PR · after O1')
      .replace('- O2 next A Add the c module', '- O2 wait A Add the c module · after O1 and O9'),
  )
  const text = ds(cwd, 'triage').out
  assert.doesNotMatch(text, /Waits on the operator/)
  assert.match(text, /Yours, after other rows:\n- O2 Add the c module \(demo; after O1 and O9\)\n- O3 Approve the PR \(demo; after O1\)/)
  const view = JSON.parse(ds(cwd, 'triage', '--json').out)
  assert.deepEqual(view.wait, [])
  assert.deepEqual(
    view.blocked.map((flag: { id: string }) => flag.id),
    ['O2', 'O3'],
  )
  assert.equal(view.live[0].next, 'O1 Add the b module')
  file(path, file(path).replace('- O1 next A Add the b module', '- O1 next A Add the b module · after O3'))
  assert.equal(JSON.parse(ds(cwd, 'triage', '--json').out).live[0].next, undefined, 'live next is the first ready agent row')
  file(path, file(path).replace('- O3 wait H Approve the PR', '- O3 next H Approve the PR'))
  const held = JSON.parse(ds(cwd, 'triage', '--json').out).blocked.map((flag: { id: string }) => flag.id)
  assert.ok(held.includes('O3'), 'an operator row in next waits on its after rows too')
})
