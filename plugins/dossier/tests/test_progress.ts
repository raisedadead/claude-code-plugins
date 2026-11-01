import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { needsTree, progress, progressLine, progressTable, taskRows } from '../engine/progress.ts'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const FIXTURE = join(import.meta.dirname, 'fixtures', 'progress')
const LEDGER = readFileSync(join(FIXTURE, 'DOSSIER.md'), 'utf8')

test('counts done rows, splits by owner and leaves rows after the milestone out of it', () => {
  const view = progress(LEDGER, 'T16')
  assert.deepEqual(
    { all: view.all, agent: view.agent, operator: view.operator, milestone: view.milestone },
    {
      all: { done: 9, total: 19 },
      agent: { done: 8, total: 14 },
      operator: { done: 1, total: 5 },
      milestone: { id: 'T16', done: 9, total: 16 },
    },
  )
})

test('a row added later still counts toward the milestone unless it waits on it', () => {
  const ledger = [
    '## Tasks',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    '| T1 | x | A | a | — | c | v |',
    '| T2 | . | H | ship | T1 | — | v |',
    '| T3 | . | A | after | T2 | — | v |',
    '| T4 | x | A | late fix | T1 | c | v |',
  ].join('\n')
  assert.deepEqual(progress(ledger, 'T2').milestone, { id: 'T2', done: 2, total: 3 })
})

test('names in-progress rows, delayed tail rows and the next rows', () => {
  const view = progress(LEDGER, 'T16')
  assert.deepEqual(
    { active: view.active, tail: view.tail, next: view.next, waiting: view.waiting },
    { active: ['T11'], tail: ['T17 T16+7d', 'T18 T16+30d'], next: ['T3'], waiting: [] },
  )
})

test('a pipe escaped inside a task cell does not shift the columns', () => {
  assert.equal(progress(LEDGER).all.done, 9)
})

test('the one line leads with the percent and the next agent row', () => {
  assert.equal(progressLine('single-worker', progress(LEDGER, 'T16')), 'single-worker 47% · 9/19 · next T3')
})

test('an all-done wave reads as ready to close', () => {
  const done = LEDGER.replaceAll(/\| ([.~]) +\|/g, '| x |')
  assert.equal(progressLine('w', progress(done)), 'w 100% · 19/19 · ready to close')
})

test('the needs tree puts each row once, under its first need, and names the other needs', () => {
  const ledger = [
    '## Tasks',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    '| T1 | x | A | a | — | c | v |',
    '| T2 | . | A | b | T1 | — | v |',
    '| T3 | . | A | c | — | — | v |',
    '| T4 | . | H | d | T2, T3 | — | v |',
    '| T5 | . | A | e | T4+7d | — | v |',
  ].join('\n')
  assert.deepEqual(
    needsTree(taskRows(ledger)).map(({ row, depth, also }) => [row.id, depth, also.join(' ')]),
    [
      ['T1', 0, ''],
      ['T2', 1, ''],
      ['T4', 2, 'T3'],
      ['T5', 3, ''],
      ['T3', 0, ''],
    ],
  )
})

test('a wave with no task rows never reads as ready to close', () => {
  assert.equal(progressLine('w', progress('## Tasks\n')), 'w 0% · 0/0')
})

test('the table rounds down so an unfinished wave never shows 100%', () => {
  const table = progressTable('single-worker', progress(LEDGER, 'T16'))
  assert.match(table, /^single-worker · 9 of 19 done · 47%$/m)
  assert.match(table, /^Agent +8 +14 +57%$/m)
  assert.match(table, /^You +1 +5 +20%$/m)
  assert.match(table, /^Up to T16 +9 +16 +56%$/m)
  assert.match(table, /^In progress, not counted: T11$/m)
  assert.match(table, /^After the milestone: T17 T16\+7d, T18 T16\+30d$/m)
})

test('ds progress reads the milestone from the wave contract', () => {
  const done = spawnSync('sh', [DS, 'progress', FIXTURE, '--json'], { encoding: 'utf8' })
  assert.equal(done.status, 0, done.stderr)
  assert.deepEqual(JSON.parse(done.stdout).milestone, { id: 'T16', done: 9, total: 16 })
})

test('ds progress --line prints one line per wave', () => {
  const done = spawnSync('sh', [DS, 'progress', FIXTURE, '--line'], { encoding: 'utf8' })
  assert.equal(done.stdout, 'progress 47% · 9/19 · next T3\n')
})

test('ds progress reads carried work from the list, not from an archived after line', () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-progress-'))
  try {
    const archive = join(root, '.scratchpad', 'dossier', '_archive', '2026-01-01-old')
    mkdirSync(archive, { recursive: true })
    writeFileSync(join(archive, 'DOSSIER.md'), '# old\n\n## Closeout\n\n2026-01-01 10:00 — closed\n\nafter: T7 smoke test (T6+7d)\n')
    writeFileSync(join(root, '.scratchpad', 'dossier', 'LATER.md'), '# Carried work\n\n- 2026-01-01-old/T8 · approve rollout · H\n')
    const done = spawnSync('sh', [DS, 'progress', '--line'], { cwd: root, encoding: 'utf8', env: { ...process.env, DOSSIER_LEDGER_ROOT: root } })
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.stdout, 'later: 1 carried — ds later lists them\n')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('ds progress exits 1 on a directory with no ledger', () => {
  const done = spawnSync('sh', [DS, 'progress', import.meta.dirname], { encoding: 'utf8' })
  assert.equal(done.status, 1)
  assert.match(done.stderr, /not found: .*DOSSIER\.md/)
})
