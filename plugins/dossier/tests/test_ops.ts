import assert from 'node:assert/strict'
import { test } from 'node:test'
import { vmFindings } from '../engine/ledger.ts'
import { sessionReport } from '../engine/session.ts'

const INDEX = '# .scratchpad index\n\n| date | slug | state | T | B | mtime | §Z |\n|---|---|---|---|---|---|---|\n| 2026-10-09 | w | live | 0/1 | 0 | x | — |\n'

function ledger(...status: string[]): string {
  const tasks = '## Tasks\n\n| id | state | who | task | needs | cite | verify |\n|----|-------|-----|------|-------|------|--------|\n| T3 | ~ | A | t | — | — | v |\n'
  return `# w\n\n\`2026-10-09\` · \`live\` · \`P1/1\`\n\n${tasks}\n## Status\n\n${status.join('\n\n')}\n`
}

function verdicts(text: string): { hint: boolean; vm6: boolean } {
  const report = sessionReport({ index: INDEX, ledgers: [{ name: '2026-10-09-w', text }], source: 'startup', title: '', titleFlag: '0', nudgeFlag: '0' })
  return { hint: report.context.includes('resume needed'), vm6: vmFindings('D', text).some((line) => line.includes('Vm.6')) }
}

test('a lone START is an open op for both readers', () => {
  assert.deepEqual(verdicts(ledger('2026-10-09 10:00 ds:build T3 START')), { hint: true, vm6: true })
})

test('a START with no timestamp is still an open op for both readers', () => {
  assert.deepEqual(verdicts(ledger('ds:build T3 START')), { hint: true, vm6: true })
})

test('prose after START and a DONE inside a joined event list close the op for both readers', () => {
  const text = ledger('2026-10-09 10:00 ds:build T3 START (figure block dropped)', '2026-10-09 10:05 ds:build T3 §X=refreshed; DONE → x cite=abc1234')
  assert.deepEqual(verdicts(text), { hint: false, vm6: false })
})

test('a pause reason that quotes DONE does not close the op for either reader', () => {
  const text = ledger('2026-10-09 10:00 ds:build T3 START', '2026-10-09 10:02 ds:pause — paused reason=ds:build T3 DONE only after CI')
  assert.deepEqual(verdicts(text), { hint: true, vm6: true })
})

test('two entries a formatter joined into one line read as two events for both readers', () => {
  const text = ledger('2026-10-09 10:00 ds:build T3 START 2026-10-09 10:05 ds:build T3 DONE → x cite=abc1234')
  assert.deepEqual(verdicts(text), { hint: false, vm6: false })
})

test('session start carries the close advisories, and none when there are none', () => {
  const base = { index: INDEX, ledgers: [], source: 'startup', title: '', titleFlag: '0', nudgeFlag: '0' }
  const note = 'advisory: .dossier/old.md belongs to no open wave — move it to .dossier/_archive/'
  assert.ok(sessionReport({ ...base, notes: [note] }).context.includes(note))
  assert.ok(!sessionReport(base).context.includes('advisory:'))
})

test('a START word inside a reason does not open an op for either reader', () => {
  const text = ledger('2026-10-09 10:02 ds:pause — paused reason=ds:build T9 START blocked on CI')
  assert.deepEqual(verdicts(text), { hint: false, vm6: false })
})
