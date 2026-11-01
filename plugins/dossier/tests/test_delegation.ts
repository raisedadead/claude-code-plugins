import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')

type Row = [id: string, state: string, task: string]

function dossier(rows: Row[], status: string[]): string {
  return [
    '# wave',
    '',
    '`2026-11-01` · `live`',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    ...rows.map(([id, state, task]) => `| ${id} | ${state} | A | ${task} | — | — | — |`),
    '',
    '## Status',
    '',
    ...status,
    '',
    '## Closeout',
    '',
  ].join('\n')
}

function check(rows: Row[], status: string[]) {
  const dir = mkdtempSync(join(tmpdir(), 'ds-delegation-'))
  try {
    writeFileSync(join(dir, 'DOSSIER.md'), dossier(rows, status))
    const done = spawnSync('sh', [DS, 'delegation-check', dir], { encoding: 'utf8' })
    const out = done.stdout.trim().split('\n')
    const fails = out.filter((line) => line.startsWith('FAIL '))
    return { status: done.status, out, fails, done }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('delegation-check exits 1 on a delegated x row with no review line', () => {
  const run = check(
    [['T1', 'x', 'build the verb']],
    [
      '2026-11-01 10:00 ds:build T1 START class=interface',
      '2026-11-01 10:01 ds:build T1 delegate=general-purpose',
      '2026-11-01 10:09 ds:build T1 DONE → x cite=abc1234',
    ],
  )
  assert.equal(run.status, 1, run.done.stderr)
  assert.equal(run.fails.length, 1, run.done.stdout)
  assert.match(run.fails[0] ?? '', /^FAIL T1: \S/)
  assert.equal(run.out.at(-1), 'DELEGATION: FAIL 1')
})

test('delegation-check exits 1 on a row with more than one rebuild line', () => {
  const run = check(
    [['T2', 'x', 'build the verb']],
    [
      '2026-11-01 10:01:05 ds:build T2 delegate=general-purpose',
      '2026-11-01 10:05:10 ds:build T2 rebuild=1 critical=2',
      '2026-11-01 10:07:15 ds:build T2 rebuild=2 critical=1',
      '2026-11-01 10:09:20 ds:build T2 review=PASS:0-warn',
    ],
  )
  assert.equal(run.status, 1, run.done.stderr)
  assert.equal(run.fails.length, 1, run.done.stdout)
  assert.match(run.fails[0] ?? '', /^FAIL T2: \S/)
  assert.equal(run.out.at(-1), 'DELEGATION: FAIL 1')
})

test('delegation-check exits 1 on a started route=pi row with no approval line', () => {
  const started = '2026-11-01 10:00 ds:build T3 START class=interface'
  const run = check([['T3', '~', 'route=pi port the parser']], [started])
  assert.equal(run.status, 1, run.done.stderr)
  assert.equal(run.fails.length, 1, run.done.stdout)
  assert.match(run.fails[0] ?? '', /^FAIL T3: \S/)
  assert.equal(run.out.at(-1), 'DELEGATION: FAIL 1')
})

test('delegation-check exits 1 on a route=delegate x row built with no spawn line', () => {
  const run = check([['T6', 'x', 'build the check; route=delegate']], [])
  assert.equal(run.status, 1, run.done.stderr)
  assert.match(run.fails[0] ?? '', /^FAIL T6: \S/)
})

test('delegation-check exits 0 on a clean ledger and counts the delegated rows', () => {
  const run = check(
    [
      ['T1', 'x', 'build the verb'],
      ['T2', '~', 'build the parser'],
      ['T3', '.', 'route=pi port the parser'],
      ['T4', 'x', 'route=pi port the writer'],
      ['T5', 'x', 'name `route=pi` in prose'],
    ],
    [
      '2026-11-01 10:01 ds:build T1 delegate=general-purpose',
      '2026-11-01 10:05:30 ds:build T1 rebuild=1 critical=2',
      '2026-11-01 10:09 ds:build T1 review=PASS:0-warn',
      '2026-11-01 10:09 ds:build T1 DONE → x cite=abc1234',
      '2026-11-01 10:10 ds:build T2 START class=interface',
      '2026-11-01 10:11 ds:build T2 delegate=general-purpose',
      '2026-11-01 10:12 ds:build T2 paused=operator',
      '2026-11-01 10:13 ds:build T4 route=pi approved="operator ok"',
      '2026-11-01 10:20 ds:build T4 DONE → x cite=def5678',
    ],
  )
  assert.equal(run.status, 0, run.done.stdout + run.done.stderr)
  assert.deepEqual(run.fails, [])
  assert.equal(run.out.at(-1), 'DELEGATION: CLEAN 2 delegated rows')
})

test("delegation-check does not count T1's lines for T12", () => {
  const borrowed = check(
    [
      ['T1', 'x', 'build the verb'],
      ['T12', 'x', 'build the parser'],
    ],
    [
      '2026-11-01 10:01 ds:build T1 review=PASS:0-warn',
      '2026-11-01 10:02 ds:build T12 delegate=general-purpose',
      '2026-11-01 10:09 ds:build T12 DONE → x cite=abc1234',
    ],
  )
  assert.equal(borrowed.status, 1, borrowed.done.stderr)
  assert.deepEqual(
    borrowed.fails.map((line) => line.split(':')[0]),
    ['FAIL T12'],
  )
  assert.equal(borrowed.out.at(-1), 'DELEGATION: FAIL 1')

  const apart = check(
    [
      ['T1', 'x', 'build the verb'],
      ['T12', 'x', 'build the parser'],
    ],
    [
      '2026-11-01 10:01 ds:build T1 rebuild=1 critical=1',
      '2026-11-01 10:02 ds:build T12 delegate=general-purpose',
      '2026-11-01 10:03 ds:build T12 rebuild=1 critical=1',
      '2026-11-01 10:09 ds:build T12 review=PASS:0-warn',
    ],
  )
  assert.equal(apart.status, 0, apart.done.stdout + apart.done.stderr)
  assert.equal(apart.out.at(-1), 'DELEGATION: CLEAN 1 delegated rows')
})
