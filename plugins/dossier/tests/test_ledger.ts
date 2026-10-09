import assert from 'node:assert/strict'
import { test } from 'vitest'
import { headerToken, rowFlip, unpushedRepos, vmFindings } from '../engine/ledger.ts'

const ROW = '| T1 | . | A | split a \\| b | — | — | v |'

function ledger(row: string): string {
  return [
    '# w',
    '',
    '`2026-10-09` · `live`',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    row,
    '',
    '## Status',
    '',
    '2026-10-09 09:00 ds:new — created slug=w',
    '',
  ].join('\n')
}

test('row-flip writes state and cite to their cells past an escaped pipe', () => {
  const done = rowFlip(ledger(ROW), 'DOSSIER.md', 'T1', 'x', 'abc123')
  assert.ok('text' in done, 'error' in done ? done.error : '')
  assert.match(done.text, /^\| T1 \| x \| A \| split a \\\| b \| — \| abc123 \| v \|$/m)
})

test('row-flip escapes a pipe in the cite it writes', () => {
  const done = rowFlip(ledger(ROW), 'DOSSIER.md', 'T1', 'x', 'a|b')
  assert.ok('text' in done)
  assert.match(done.text, /\| a\\\|b \| v \|$/m)
})

test('vm-checks reads the cite of a row with an escaped pipe', () => {
  const done = ledger('| T1 | x | A | split a \\| b | — | abc123 | v |')
  const findings = vmFindings('DOSSIER.md', done)
  assert.deepEqual(
    findings.filter((line) => line.includes('Vm.3')),
    [],
  )
})

test('a CRLF header reads as its state', () => {
  assert.equal(headerToken('# w\r\n\r\n`2026-10-09` · `live`\r\n\r\n## Goal\r\n'), 'live')
})

test('a header-shaped line under the first section is not the header', () => {
  assert.equal(headerToken('# w\n\n## Goal\n\n`2026-10-09` · `live`\n'), '')
})

test('a header whose first field is not a date is not the header', () => {
  assert.equal(headerToken('# w\n\n`draft` · `live`\n\n## Goal\n'), '')
})

function repos(rule: string, rows: string[], eol = '\n'): string {
  return ['## Repos', '', '| repo | pushed |', rule, ...rows, ''].join(eol)
}

test('an aligned rule row is not a repo', () => {
  assert.deepEqual(unpushedRepos(repos('| :--- | ---: |', ['| a | no |', '| b | yes |'])), ['a'])
})

test('a CRLF or tabbed rule row is not a repo', () => {
  assert.deepEqual(unpushedRepos(repos('|------|--------|', ['| a | no |', '| b | yes |'], '\r\n')), ['a'])
  assert.deepEqual(unpushedRepos(repos('|---\t|---|', ['| a | no |', '| b | yes |'])), ['a'])
})

test('a hand-typed Yes is pushed', () => {
  assert.deepEqual(unpushedRepos(repos('|---|---|', ['| a | Yes |', '| b | NO |'])), ['b'])
})

test('a blank pushed cell is not pushed', () => {
  assert.deepEqual(unpushedRepos(repos('|---|---|', ['| a |  |', '| b | yes |'])), ['a'])
})

test('a Repos table with no pushed column names no repo', () => {
  const text = ['## Repos', '', '| repo | branch |', '|---|---|', '| a | main |', ''].join('\n')
  assert.deepEqual(unpushedRepos(text), [])
})
