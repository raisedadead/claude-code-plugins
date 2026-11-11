import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { handoff } from '../engine/handoff.ts'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const STAMP = '2026-11-11 14:30'
const GOAL = [
  '/goal ds:build --auto printed DONE or PAUSE for demo, and §S records a matching auto-stop or PAUSE line stamped at or after 2026-11-11 14:30.',
  '/dossier:build --auto',
]

function ledger(...rows: string[]): string {
  return ['## Tasks', '| id | state | who | task | needs | cite | verify |', '|----|-------|-----|------|-------|------|--------|', ...rows].join('\n')
}

test('a ready agent row gets the goal lines', () => {
  assert.deepEqual(handoff(ledger('| T1 | x | A | a | — | c | v |', '| T2 | . | A | b | T1 | — | v |'), 'demo', STAMP), GOAL)
})

test('a paused agent row is named before the goal lines', () => {
  assert.deepEqual(handoff(ledger('| T1 | ~ | A | a | — | — | v |'), 'demo', STAMP), ['paused: T1 a', ...GOAL])
})

test('only the operator rows the next agent row needs are named', () => {
  const text = ledger('| T1 | . | H | Push main | — | — | v |', '| T2 | . | H | Tag release | — | — | v |', '| T3 | . | A | refresh | T1 | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['after: T1 Push main', ...GOAL])
})

const RUN = 'https://github.com/o/r/actions/runs/1'

function withStatus(text: string, ...lines: string[]): string {
  return [text, '', '## Status', '', ...lines].join('\n')
}

test('a push row whose CI watch paused names the failed run, not the push', () => {
  const rows = ledger('| T1 | . | H | Push main | — | — | v |', '| T2 | . | A | refresh | T1 | — | v |')
  const text = withStatus(rows, '2026-11-11 14:00 ds:build T1 START', `2026-11-11 14:05 ds:build T1 PAUSE reason=ci:${RUN}`)
  assert.deepEqual(handoff(text, 'demo', STAMP), [`ci: T1 ${RUN}`, ...GOAL])
  const alone = withStatus(ledger('| T1 | . | H | Push main | — | — | v |'), `2026-11-11 14:05 ds:build T1 PAUSE reason=ci:${RUN}`)
  assert.deepEqual(handoff(alone, 'demo', STAMP), [`ci: T1 ${RUN}`])
})

test('a CI pause on another row, or followed by a later line, leaves the push step', () => {
  const rows = ledger('| T1 | . | H | Push main | — | — | v |')
  const other = withStatus(rows, `2026-11-11 14:05 ds:build T9 PAUSE reason=ci:${RUN}`)
  assert.deepEqual(handoff(other, 'demo', STAMP), ['operator: T1 Push main'])
  const later = withStatus(rows, `2026-11-11 14:05 ds:build T1 PAUSE reason=ci:${RUN}`, '2026-11-11 14:20 ds:build T1 PAUSE reason=push:not pushed')
  assert.deepEqual(handoff(later, 'demo', STAMP), ['operator: T1 Push main'])
  const joined = withStatus(rows, `2026-11-11 14:05 ds:build T1 PAUSE reason=ci:${RUN} 2026-11-11 14:20 ds:build T1 START`)
  assert.deepEqual(handoff(joined, 'demo', STAMP), ['operator: T1 Push main'])
  const quoted = [rows, '', '## Constraints', '', `2026-11-11 14:05 ds:build T1 PAUSE reason=ci:${RUN}`].join('\n')
  assert.deepEqual(handoff(quoted, 'demo', STAMP), ['operator: T1 Push main'])
})

test('an operator row in progress is still the operator step', () => {
  assert.deepEqual(handoff(ledger('| T1 | ~ | H | Push main | — | — | v |'), 'demo', STAMP), ['operator: T1 Push main'])
})

test('a row waiting on a question asks for its answer', () => {
  assert.deepEqual(handoff(ledger('| T1 | ? | A | pick a host | — | — | v |'), 'demo', STAMP), ['answer: T1 pick a host'])
})

test('rows left only on a delay carry into the close plan', () => {
  const text = ledger('| T1 | x | A | a | — | c | v |', '| T2 | . | A | recheck | T1+30d | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['close: ds close demo --complete --carry T2 --plan'])
})

test('rows that wait on unfinished rows are idle', () => {
  const text = ledger('| T1 | ! | A | a | — | — | v |', '| T2 | . | A | b | T1 | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['answer: T1 a'])
  assert.deepEqual(handoff(ledger('| T1 | . | A | b | T9 | — | v |'), 'demo', STAMP), ['idle: no row is ready; ds progress shows why'])
})

test('an agent row behind a ready operator row names that row first', () => {
  const text = ledger('| T1 | x | A | a | — | c | v |', '| T2 | . | H | Push main | T1 | — | v |', '| T3 | . | A | refresh | T2 | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['after: T2 Push main', ...GOAL])
})

test('an operator row with no agent row after it gets no goal', () => {
  const text = ledger('| T1 | x | A | a | — | c | v |', '| T2 | . | H | Push main | T1 | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['operator: T2 Push main'])
})

test('a blocked row asks for its answer', () => {
  const text = ledger('| T1 | x | A | a | — | c | v |', '| T2 | ! | A | migrate | T1 | — | v |')
  assert.deepEqual(handoff(text, 'demo', STAMP), ['answer: T2 migrate'])
})

test('a ledger with every row done points at the close plan', () => {
  assert.deepEqual(handoff(ledger('| T1 | x | A | a | — | c | v |'), 'demo', STAMP), ['close: ds close demo --complete --plan'])
})

test('a ledger with no rows is not read as done', () => {
  assert.deepEqual(handoff(ledger(), 'demo', STAMP), ['operator: §T has no rows'])
})

test('the cli prints the lines for a dossier and exits 1 on a missing ledger', () => {
  const root = mkdtempSync(join(tmpdir(), 'handoff-'))
  try {
    const dir = join(root, '2026-11-11-demo')
    mkdirSync(dir)
    writeFileSync(join(dir, 'DOSSIER.md'), ledger('| T1 | . | H | Push main | — | — | v |'))
    const ok = spawnSync(DS, ['handoff', dir], { encoding: 'utf8' })
    assert.equal(ok.status, 0)
    assert.equal(ok.stdout, 'operator: T1 Push main\n')
    const missing = spawnSync(DS, ['handoff', join(root, 'nope')], { encoding: 'utf8' })
    assert.equal(missing.status, 1)
    assert.equal(spawnSync(DS, ['handoff'], { encoding: 'utf8' }).status, 64)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
