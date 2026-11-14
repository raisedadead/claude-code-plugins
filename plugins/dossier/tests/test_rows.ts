import assert from 'node:assert/strict'
import { test } from 'vitest'
import { formatRow, parseRow, scanRows, shapeErrors, trigger } from '../engine/rows.ts'

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
