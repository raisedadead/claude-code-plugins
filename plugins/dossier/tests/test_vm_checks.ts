import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

let ws = ''
let clean = (): void => {}
beforeEach(() => {
  ;({ dir: ws, clean } = tempRoot('dossier-vm-'))
})
afterEach(() => clean())

function isoAgo(seconds: number): string {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

function writeClean(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'DOSSIER.md'),
    '# clean\n\n' +
      '`2026-07-07` · `live` · `P1/1`\n\n' +
      '## §T — Task ledger\n\n' +
      '| id | P  | state | task  | cite   | verify |\n' +
      '|----|----|-------|-------|--------|--------|\n' +
      '| T1 | P1 | x     | do it | abc123 | —      |\n\n' +
      '## §S — Rolling status log\n\n' +
      '2026-07-07 12:00 ds:new — created slug=clean phase=P1\n\n' +
      '2026-07-07 12:01 ds:build T1 START\n\n' +
      '2026-07-07 12:05 ds:build T1 DONE → x cite=abc123\n',
  )
}

function writeDirty(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'DOSSIER.md'),
    '# dirty\n\n' +
      '`2026-07-07` · `live` · `P1/1`\n\n' +
      '## §T — Task ledger\n\n' +
      '| id | P  | state | task   | cite | verify |\n' +
      '|----|----|-------|--------|------|--------|\n' +
      '| T3 | P1 | x     | broken |      | —      |\n\n' +
      '## §S — Rolling status log\n\n' +
      '2026-07-07 12:00 ds:new — created slug=dirty phase=P1\n\n' +
      'ds:build T2 START\n\n' +
      '2026-07-07 12:10 ds:build T9 START\n',
  )
  writeFileSync(join(dir, 'DOSSIER.md.tmp'), '')
  writeFileSync(join(dir, '.ds-lock'), `{"started": "${isoAgo(3600)}", "skill": "ds:build"}`)
}

function writeShaped(dir: string, header: string, sep: string, row: string, heading = '## §T — Task ledger'): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), `# shaped\n\n\`2026-08-04\` · \`live\`\n\n${heading}\n\n${header}\n${sep}\n${row}\n`)
}

function writeWordedPair(dir: string, tasksHeading: string, statusHeading: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'DOSSIER.md'),
    '# wp\n\n' +
      '`2026-08-04` · `live`\n\n' +
      `${tasksHeading}\n\n` +
      '| id | state | who | task | needs | cite | verify |\n' +
      '|----|-------|-----|------|-------|------|--------|\n' +
      '| T1 | x     | A   | a    | —     |      | —      |\n\n' +
      `${statusHeading}\n\n` +
      'ds:build T9 START\n',
  )
}

async function vmChecks(root: string): Promise<{ code: number; out: string }> {
  const done = await ds(ws, ['vm-checks', root])
  return { code: done.code, out: done.stdout + done.stderr }
}

async function assertVm3ByHeaderName(label: string, root: string, want: boolean): Promise<void> {
  const { out } = await vmChecks(root)
  if (want) assert.match(out, /CRITICAL Vm.3/, `${label}: an x-row with an empty cite must flag Vm.3; got: ${out}`)
  else assert.doesNotMatch(out, /CRITICAL Vm.3/, `${label}: a cited x-row must not flag Vm.3; got: ${out}`)
}

async function assertThreeFindings(label: string, root: string): Promise<void> {
  const { out } = await vmChecks(root)
  assert.match(out, /CRITICAL Vm.3/, `${label}: Vm.3 must fire; got: ${out}`)
  assert.match(out, /Vm.2/, `${label}: Vm.2 must fire, so the Status pattern is exercised; got: ${out}`)
  assert.match(out, /Vm.6/, `${label}: Vm.6 must fire, so START/DONE pairing reads the Status section; got: ${out}`)
}

test('a clean tree exits 0 and emits no findings', async () => {
  const root = join(ws, 'clean', '.scratchpad')
  writeClean(join(root, 'dossier', '2026-07-07-clean'))
  const { code, out } = await vmChecks(root)
  assert.equal(code, 0, out)
  assert.equal(out, '')
})

test('a dirty tree exits non-zero and flags Vm.2, Vm.3, Vm.6, Vm.8 and Vm.9', async () => {
  const root = join(ws, 'dirty', '.scratchpad')
  writeDirty(join(root, 'dossier', '2026-07-07-dirty'))
  const { code, out } = await vmChecks(root)
  assert.notEqual(code, 0)
  assert.match(out, /Vm.2/, out)
  assert.match(out, /CRITICAL Vm.3/, out)
  assert.match(out, /Vm.6/, out)
  assert.match(out, /Vm.8/, out)
  assert.match(out, /Vm.9/, out)
})

test('state and cite are read by header name, not by column position', async () => {
  const header = '| id | state | who | task  | needs | cite | verify |'
  const sep = '|----|-------|-----|-------|-------|------|--------|'
  const citedHeader = '| id | state | who | task  | needs | cite   | verify |'
  const citedSep = '|----|-------|-----|-------|-------|--------|--------|'

  const legacy = join(ws, 'legacy', '.scratchpad')
  writeShaped(
    join(legacy, 'dossier', '2026-08-04-legacy'),
    '| id | P  | state | task  | cite | verify |',
    '|----|----|-------|-------|------|--------|',
    '| T1 | P1 | x     | do it | —    | —      |',
  )
  await assertVm3ByHeaderName('legacy id/P/state/task/cite layout', legacy, true)

  const shifted = join(ws, 'shifted', '.scratchpad')
  writeShaped(join(shifted, 'dossier', '2026-08-04-shifted'), header, sep, '| T1 | x     | A   | do it | —     | —    | —      |')
  await assertVm3ByHeaderName('who/needs layout, uncited', shifted, true)

  const shiftedOk = join(ws, 'shifted-ok', '.scratchpad')
  writeShaped(join(shiftedOk, 'dossier', '2026-08-04-shifted-ok'), citedHeader, citedSep, '| T1 | x     | A   | do it | —     | abc123 | —      |')
  await assertVm3ByHeaderName('who/needs layout, cited', shiftedOk, false)

  const worded = join(ws, 'worded', '.scratchpad')
  writeShaped(join(worded, 'dossier', '2026-08-04-worded'), header, sep, '| T1 | x     | A   | do it | —     | —    | —      |', '## Tasks')
  await assertVm3ByHeaderName('worded Tasks heading, uncited', worded, true)

  const wordedOk = join(ws, 'worded-ok', '.scratchpad')
  writeShaped(join(wordedOk, 'dossier', '2026-08-04-worded-ok'), citedHeader, citedSep, '| T1 | x     | A   | do it | —     | abc123 | —      |', '## Tasks')
  await assertVm3ByHeaderName('worded Tasks heading, cited', wordedOk, false)
})

test('every heading spelling of the Tasks and Status pair fires Vm.3, Vm.2 and Vm.6', async () => {
  for (const [tasks, status] of [
    ['## Tasks', '## Status'],
    ['## Tasks — Task ledger', '## Status — Rolling status log'],
    ['## §T — Task ledger', '## §S — Rolling status log'],
  ]) {
    const slug = tasks.replace(/[^A-Za-z0-9]/g, '-')
    const root = join(ws, `pair${slug}`, '.scratchpad')
    writeWordedPair(join(root, 'dossier', '2026-08-04-pair'), tasks, status)
    await assertThreeFindings(`heading pair '${tasks}'`, root)
  }
})

test('a heading that merely starts with the section word is not that section', async () => {
  const root = join(ws, 'lookalike', '.scratchpad')
  writeWordedPair(join(root, 'dossier', '2026-08-04-lookalike'), '## Taskslist', '## Statusline')
  const { out } = await vmChecks(root)
  assert.doesNotMatch(out, /Vm\./, `a heading that merely starts with the section word is not that section; got: ${out}`)
})

test('## §Task is not read as the Tasks section', async () => {
  const root = join(ws, 'sigil-lookalike', '.scratchpad')
  writeWordedPair(join(root, 'dossier', '2026-08-04-sigil'), '## §Task ledger', '## §Status log')
  const { out } = await vmChecks(root)
  assert.doesNotMatch(out, /Vm\./, `## §Task must not be read as the Tasks section; got: ${out}`)
})

test('a Tasks header naming neither state nor cite says so and emits no row-level verdict', async () => {
  const root = join(ws, 'unnamed', '.scratchpad')
  writeShaped(join(root, 'dossier', '2026-08-04-unnamed'), '| id | status | owner | task |', '|----|--------|-------|------|', '| T1 | x      | A     | do   |')
  const { out } = await vmChecks(root)
  assert.match(out, /names no state or cite column/, out)
  assert.doesNotMatch(out, /CRITICAL Vm.3/, out)
})
