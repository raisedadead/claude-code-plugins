import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rowFlip, vmFindings } from '../engine/ledger.ts'

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
  assert.equal(done.error, undefined)
  assert.match(done.text ?? '', /^\| T1 \| x \| A \| split a \\\| b \| — \| abc123 \| v \|$/m)
})

test('row-flip escapes a pipe in the cite it writes', () => {
  const done = rowFlip(ledger(ROW), 'DOSSIER.md', 'T1', 'x', 'a|b')
  assert.match(done.text ?? '', /\| a\\\|b \| v \|$/m)
})

test('vm-checks reads the cite of a row with an escaped pipe', () => {
  const done = ledger('| T1 | x | A | split a \\| b | — | abc123 | v |')
  const findings = vmFindings('DOSSIER.md', done)
  assert.deepEqual(
    findings.filter((line) => line.includes('Vm.3')),
    [],
  )
})
