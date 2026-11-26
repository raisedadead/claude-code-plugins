import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { formatRow, parseRow, scanRows, shapeErrors, trigger } from '../engine/rows.ts'
import { ds, file, repo } from './kit.ts'

const PAUSE_ERROR = /names paused but does not start with it/

test('pause not first: an open row whose tail names paused anywhere but the start is out of shape', () => {
  for (const line of [
    '- O309 wait H Apply the access list · gate H3; paused until after the K3s move',
    '- O2 next A Build it · Paused until Monday',
    '- O3 now A Build it · after O1; paused for now',
    '- O4 next A Build it · paused: a next row is not a pause',
  ]) {
    const row = parseRow(line)
    assert.ok(row, line)
    assert.ok(
      shapeErrors(row).some((why) => PAUSE_ERROR.test(why)),
      line,
    )
  }
})

test('pause not first: a pause written first, a word that only contains paused, and closed or later rows pass', () => {
  for (const line of [
    '- O7 wait H Ask about X · paused: back after the incident',
    '- O10 wait H Hold it · Paused',
    '- O9 wait H Rename it · pausedness is not a pause',
    '- O11 done A Ship it · 3f2a9c1, the paused rows carried over',
    '- O12 drop A Port it · paused for good',
    '- O13 later H Look again · until 2026-12-01',
  ]) {
    const row = parseRow(line)
    assert.ok(row, line)
    assert.deepEqual(
      shapeErrors(row).filter((why) => PAUSE_ERROR.test(why)),
      [],
      line,
    )
  }
})

test('pause not first: ds set refuses the row, and ds triage lists a hand-written one as out of shape', () => {
  const cwd = repo()
  const register = join(cwd, '.scratchpad/OPEN-WORK.md')
  file(register, '# Open work\n\n## Rows\n\n- O7 next H t\n- O8 wait H u · gate H3; paused until later\n')
  const refused = ds(cwd, 'set', 'O7', 'wait', 'gate H3; paused until later')
  assert.equal(refused.code, 1)
  assert.match(refused.err, PAUSE_ERROR)
  assert.match(file(register), /^- O7 next H t$/m)
  assert.equal(ds(cwd, 'set', 'O7', 'wait', 'paused: gate H3').code, 0)
  const shape = JSON.parse(ds(cwd, 'triage', '--json').out).shape as { id: string; title: string; why: string }[]
  assert.deepEqual(
    shape.filter((flag) => PAUSE_ERROR.test(flag.why)).map((flag) => flag.title.slice(0, 5)),
    ['- O8 '],
  )
})

test('a row reads and writes back the same', () => {
  for (const line of [
    '- O193 next A Remove the review gate',
    '- O196 done A Drop the claim check · 3f2a9c1',
    '- O195 later H Re-read the spend · until 2026-12-01',
  ]) {
    const row = parseRow(line)
    assert.ok(row)
    assert.equal(formatRow(row), line)
  }
})

test('the later tail grammar reads dates, dossiers and PRs, and nothing else', () => {
  assert.deepEqual(trigger('until 2026-12-01'), { kind: 'until', date: '2026-12-01' })
  assert.deepEqual(trigger('after model-routing'), { kind: 'after', slug: 'model-routing' })
  assert.deepEqual(trigger('after pr raisedadead/dotfiles#12'), { kind: 'pr', repo: 'raisedadead/dotfiles', number: 12 })
  for (const tail of ['someday', 'until next week', 'after the review', '']) assert.equal(trigger(tail), undefined)
})

test('a row out of shape is named with its reason', () => {
  const long = parseRow(`- O1 next A ${'x'.repeat(81)}`)
  assert.ok(long)
  assert.match(shapeErrors(long).join(), /over 80/)
  assert.match(shapeErrors(parseRow('- O1 next A Fix **this**')!).join(), /bold or code/)
  assert.match(shapeErrors(parseRow('- O1 next A Port what T4 did')!).join(), /another ID/)
  assert.match(shapeErrors(parseRow('- O1 later A Look again · someday')!).join(), /needs a tail/)
  assert.match(shapeErrors(parseRow('- O1 drop A Old idea')!).join(), /reason/)
  assert.deepEqual(shapeErrors(parseRow('- O1 drop A Old idea · replaced by a new row')!), [])
})

test('a scan reports lines that are not rows, and keeps the good ones', () => {
  const { rows, bad } = scanRows('- O1 next A Good\n- O2 maybe A Bad state\nprose\n', 10)
  assert.deepEqual(
    rows.map((r) => r.id),
    ['O1'],
  )
  assert.deepEqual(
    bad.map((b) => [b.line, b.why.slice(0, 18)]),
    [
      [11, 'row is out of shap'],
      [12, 'not a row'],
    ],
  )
})
