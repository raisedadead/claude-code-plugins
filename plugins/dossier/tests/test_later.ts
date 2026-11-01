import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { addCarried, carriedRow, laterRows, laterSummary, removeLater } from '../engine/later.ts'
import type { Row } from '../engine/progress.ts'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')

function row(id: string, who: string, task: string, needs: string[] = []): Row {
  return { id, state: '.', who, task, needs, cite: '—', verify: '—' }
}

const STATUS = ['2026-11-01 21:42 ds:build T9 §X=refreshed; DONE → x cite=844dbeb', '2026-11-02 09:00 ds:build T8 PAUSE reason=ds:build T8 DONE only after CI']

test('a carried row keys by its first origin and resolves a delayed need to a due date', () => {
  const task = 'census re-check (from a T3) (from suite-review-apply T14)'
  const carried = carriedRow('2026-11-01-managed-team', row('T10', 'H', task, ['T9+30d']), STATUS)
  assert.deepEqual(carried, { key: 'a/T3', task, who: 'T9+30d', due: '2026-12-01' })
  const plain = carriedRow('2026-11-01-managed-team', row('T12', 'A', 'smoke test', ['T8+7d']), STATUS)
  assert.deepEqual(plain, { key: '2026-11-01-managed-team/T12', task: 'smoke test', who: 'T8+7d' })
})

test('a DONE entry joined onto another entry on one line still gives the due date', () => {
  const joined = ['2026-11-03 10:00 ds:build T9 START 2026-11-03 10:05 ds:build T9 DONE → x']
  assert.equal(carriedRow('w', row('T10', 'H', 'check', ['T9+2d']), joined).due, '2026-11-05')
})

test('adding and removing rows keeps every line the list does not own', () => {
  const hand = '# Carried work\n\nnote: ask the owner first\n\n- a/T1 · one · H\n- a/T2 · x\n'
  const { text } = addCarried(hand, [{ key: 'b/T1', task: 'new', who: 'H' }])
  assert.match(text, /^note: ask the owner first$/m)
  assert.match(text, /^- a\/T2 · x$/m)
  assert.match(text, /^- b\/T1 · new · H$/m)
  const left = removeLater(text, 'a/T1') ?? ''
  assert.match(left, /^note: ask the owner first$/m)
  assert.doesNotMatch(left, /a\/T1 · one/)
})

test('a row already on the list is not added again', () => {
  const first = addCarried(undefined, [{ key: 'a/T1', task: 't one', who: 'H' }])
  assert.deepEqual(first.added, ['a/T1'])
  const again = addCarried(first.text, [
    { key: 'a/T1', task: 't one', who: 'H' },
    { key: 'b/T2', task: 't · two', who: 'T1+7d', due: '2026-12-01' },
  ])
  assert.deepEqual(again.added, ['b/T2'])
  assert.deepEqual(laterRows(again.text), [
    { key: 'a/T1', task: 't one', who: 'H' },
    { key: 'b/T2', task: 't · two', who: 'T1+7d', due: '2026-12-01' },
  ])
})

test('the summary counts every row and names each row due on or before today', () => {
  const { text } = addCarried(undefined, [
    { key: 'a/T1', task: 'due one', who: 'T1+7d', due: '2026-12-01' },
    { key: 'a/T2', task: 'undated', who: 'H' },
  ])
  assert.deepEqual(laterSummary(text, '2026-11-30'), ['later: 2 carried — ds later lists them'])
  assert.deepEqual(laterSummary(text, '2026-12-01'), ['later: 2 carried — ds later lists them', 'due: a/T1 due one'])
  assert.deepEqual(laterSummary(undefined, '2026-12-01'), [])
})

test('removing a key drops only that row, and an unknown key returns nothing', () => {
  const { text } = addCarried(undefined, [
    { key: 'a/T1', task: 'one', who: 'H' },
    { key: 'a/T2', task: 'two', who: 'H' },
  ])
  const left = removeLater(text, 'a/T1')
  assert.ok(left !== undefined)
  assert.deepEqual(
    laterRows(left).map((entry) => entry.key),
    ['a/T2'],
  )
  assert.equal(removeLater(text, 'a/T9'), undefined)
})

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ds-later-'))
  mkdirSync(join(dir, '.scratchpad', 'dossier'), { recursive: true })
  return dir
}

function ds(dir: string, ...args: string[]) {
  return spawnSync('sh', [DS, ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, DOSSIER_LEDGER_ROOT: dir } })
}

test('ds later lists the rows, and ds later done removes one and refuses an unknown key', () => {
  const dir = root()
  try {
    const list = join(dir, '.scratchpad', 'dossier', 'LATER.md')
    writeFileSync(list, addCarried(undefined, [{ key: 'a/T1', task: 'one', who: 'H' }]).text)
    const shown = ds(dir, 'later')
    assert.equal(shown.status, 0, shown.stderr)
    assert.match(shown.stdout, /^a\/T1 · one · H$/m)
    assert.equal(ds(dir, 'later', 'done', 'a/T9').status, 1)
    const done = ds(dir, 'later', 'done', 'a/T1')
    assert.equal(done.status, 0, done.stderr)
    assert.deepEqual(laterRows(readFileSync(list, 'utf8')), [])
    assert.equal(ds(dir, 'later', 'bogus').status, 64)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
