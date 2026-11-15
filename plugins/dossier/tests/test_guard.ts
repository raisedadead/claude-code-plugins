import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { checkedPlan, ds, file, PLAN, planned, repo } from './kit.ts'

const TEXT = 'demo waits on the operator: its line O100 is wait (paused: x). The operator resumes it with: ds set O100 next --who A'
const VERBS: string[][] = [['anchors'], ['next'], ['mission', 'O1'], ['verify', 'O1'], ['done', 'O1'], ['integrate', 'demo-lane-1'], ['shape']]

function register(cwd: string): string {
  return join(cwd, '.scratchpad/OPEN-WORK.md')
}

test('a waiting line stops each build verb with exit 3 (I2)', () => {
  const cwd = repo()
  checkedPlan(cwd)
  assert.equal(ds(cwd, 'set', 'O100', 'wait', 'paused: x', '--who', 'H').code, 0)
  for (const verb of VERBS) {
    const done = ds(cwd, ...verb)
    assert.equal(done.code, 3, verb.join(' '))
    assert.equal(done.err, `ds ${verb[0]}: ${TEXT}`)
  }
  for (const verb of [['done', 'O1', '--cite', 'x'], ['lanes'], ['close', 'all built']]) {
    assert.doesNotMatch(ds(cwd, ...verb).err, /waits on the operator: its line/, verb.join(' '))
  }
})

test('after the operator resumes the line the guard is gone (I2)', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'set', 'O100', 'wait', 'paused: x', '--who', 'H')
  assert.equal(ds(cwd, 'set', 'O100', 'next', '--who', 'A').code, 0)
  for (const verb of VERBS) assert.doesNotMatch(ds(cwd, ...verb).err, /waits on the operator: its line/, verb.join(' '))
})

test('anchors moves a next line to now (I3)', () => {
  const cwd = repo()
  checkedPlan(cwd)
  assert.match(file(register(cwd)), /^- O100 next A /m)
  const done = ds(cwd, 'anchors')
  assert.equal(done.code, 0, done.err)
  assert.match(file(register(cwd)), /^- O100 now A /m)
})

test('mission moves a line set back to next to now (I3)', () => {
  const cwd = repo()
  checkedPlan(cwd)
  ds(cwd, 'anchors')
  ds(cwd, 'set', 'O100', 'next')
  assert.match(file(register(cwd)), /^- O100 next A /m)
  const done = ds(cwd, 'mission', 'O1')
  assert.equal(done.code, 0, done.err)
  assert.match(file(register(cwd)), /^- O100 now A /m)
})

test('a dossier with no row key skips the guard (K3)', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, PLAN.replace(/^row: .*\n/m, ''))
  ds(cwd, 'set', 'O100', 'wait', 'paused: x', '--who', 'H')
  assert.doesNotMatch(ds(cwd, 'next').err, /waits on the operator: its line/)
  assert.equal(ds(cwd, 'lanes').code, 0)
  assert.match(ds(cwd, 'lint').err, /header: row/)
  const anchors = ds(cwd, 'anchors')
  assert.equal(anchors.code, 1)
  assert.match(anchors.err, /run ds lint first: 1 problems/)
  assert.doesNotMatch(anchors.err, /waits on the operator/)
})
