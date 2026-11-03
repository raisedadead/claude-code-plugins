import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { sessionReport } from '../engine/session.ts'

const LEDGER = readFileSync(join(import.meta.dirname, 'fixtures', 'progress', 'DOSSIER.md'), 'utf8')
const NAME = '2026-10-08-single-worker'
const INDEX = `# .scratchpad index\n\n| date | slug | state | T | B | mtime | §Z |\n|---|---|---|---|---|---|---|\n| 2026-10-08 | single-worker | live | 9/19 | 0 | x | — |\n`

function report(text: string, index = INDEX) {
  return sessionReport({ index, ledgers: [{ name: NAME, text, milestone: 'T16' }], source: 'startup', title: '', titleFlag: '0', nudgeFlag: '1' })
}

test('session start leads with the progress line and fits 6 lines', () => {
  const out = report(LEDGER)
  const rows = out.context.split('\n')
  assert.equal(rows[0], `dossier live: ${NAME} 47% · 9/19 · next T3`)
  assert.equal(rows[1], 'Agent 8/14 · You 1/5 · Up to T16 9/16 · in progress T11 · later T17 (T16+7d), T18 (T16+30d)')
  assert.ok(rows.length <= 6, out.context)
  assert.doesNotMatch(out.context, /INDEX\.md|### Tasks/)
  assert.equal(out.system, `dossier live: ${NAME} 47% · 9/19 · next T3 — /dossier:status for the sit-rep.`)
})

test('an open resume adds a pointer, not the task table', () => {
  const open = report(`${LEDGER}\n2026-10-09 03:00 ds:build T11 START\n`)
  assert.match(open.context, /^dossier live: /)
  assert.match(open.context, /resume needed/)
  assert.doesNotMatch(open.context, /### Tasks|### Repos/)
  assert.ok(open.context.length <= 1000, `${open.context.length} chars`)
})

test('a wave whose only open rows wait on a delay reads as ready to close with the carry named', () => {
  const tail = [
    '# w',
    '',
    '`2026-10-08` · `live`',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    '| T1 | x | A | a | — | c | v |',
    '| T2 | . | A | b | T1+7d | — | v |',
    '',
  ].join('\n')
  assert.match(report(tail).context.split('\n')[0] ?? '', / 50% · 1\/2 · ready to close · carry T2$/)
})

test('an INDEX that still carries the P column names the same live wave', () => {
  const legacy = `# .scratchpad index\n\n| date | slug | state | P | T | B | mtime | §Z |\n|---|---|---|---|---|---|---|---|\n| 2026-10-08 | single-worker | live | P1/1 | 9/19 | 0 | x | — |\n`
  assert.match(report(LEDGER, legacy).context, new RegExp(`^dossier live: ${NAME} 47%`))
})

test('the repos line skips an aligned rule row and counts every repo not pushed', () => {
  const repos = [
    '',
    '## Repos',
    '',
    '| repo | branch | ahead | tag | pushed | notes |',
    '| :--- | :---: | ---: | --- | --- | --- |',
    '| a | main | 0 | — | yes | |',
    '| b | main | 0 | — | — | |',
    '| c | main | 2 | — | no | |',
    '',
  ].join('\n')
  assert.match(report(LEDGER + repos).context, /^repos 3 · unpushed 2$/m)
})

test('session start shows the carried-work count and each due row, with no live wave', () => {
  const later = '# Carried work\n\n- a/T1 · census re-check · T9+30d · due 2026-12-01\n- a/T2 · rig work · H\n'
  const index = '# .scratchpad index\n\n| date | slug | state | T | B | mtime | §Z |\n|---|---|---|---|---|---|---|\n'
  const base = { index, ledgers: [], source: 'startup', title: '', titleFlag: '0', nudgeFlag: '1', later }
  const out = sessionReport({ ...base, today: '2026-12-01' })
  assert.equal(out.context, 'later: 2 carried — ds later lists them\ndue: a/T1 census re-check')
  assert.equal(out.system, 'dossier: carried work due — a/T1. ds later lists it.')
  assert.equal(sessionReport({ ...base, today: '2026-11-30' }).system, '')
  assert.equal(sessionReport({ ...base, today: '2026-12-01', source: 'compact' }).system, '')
  const two = `${index}| 2026-10-08 | a | live | 0/1 | 0 | x | — |\n| 2026-10-09 | b | live | 0/1 | 0 | x | — |\n`
  assert.match(sessionReport({ ...base, index: two, today: '2026-12-01' }).system, /2 live .* carried work due — a\/T1/)
})
