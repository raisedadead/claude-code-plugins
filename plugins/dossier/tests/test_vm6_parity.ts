import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const SLUG = '2026-07-31-parity'
const HEAD = '`2026-07-31` · `live` · `P1/1`\n\n## §T\n\n| T1 | P1 | . | do thing | — | — |\n\n## §S\n\n'
const PAYLOAD = '{"hook_event_name":"SessionStart","source":"startup","session_title":""}'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function fixtureWithStatusLog(...lines: string[]): string {
  const { dir, clean } = tempRoot('dossier-vm6-')
  cleanups.push(clean)
  const folder = join(dir, '.scratchpad', 'dossier', SLUG)
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, 'DOSSIER.md'), HEAD + lines.map((line) => `${line}\n`).join(''))
  return dir
}

async function vmChecksReportsUnpaired(ws: string): Promise<boolean> {
  const done = await ds(ws, ['vm-checks', '.scratchpad'])
  return (done.stdout + done.stderr).includes('Vm.6')
}

async function sessionStartReportsUnpaired(ws: string): Promise<boolean> {
  const done = await ds(ws, ['session-start'], {}, PAYLOAD)
  return done.stdout.includes('resume needed')
}

async function assertBothEnforcersAgree(ws: string, want: 'yes' | 'no', label: string): Promise<void> {
  const fromVm = (await vmChecksReportsUnpaired(ws)) ? 'yes' : 'no'
  const fromHook = (await sessionStartReportsUnpaired(ws)) ? 'yes' : 'no'
  assert.equal(fromVm, fromHook, `${label}: enforcers disagree — vm-checks=${fromVm} session-start=${fromHook}`)
  assert.equal(fromVm, want, `${label}: expected unpaired=${want}, both reported ${fromVm}`)
}

test('normal backprop flow: pending START resolved by an id-bearing DONE', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:backprop pending START', '2026-07-31 10:05 ds:backprop B1 DONE')
  await assertBothEnforcersAgree(ws, 'no', 'normal backprop flow: pending START resolved by an id-bearing DONE')
})

test('START with no DONE anywhere', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:build T3 START')
  await assertBothEnforcersAgree(ws, 'yes', 'START with no DONE anywhere')
})

test('START and DONE on an identical target', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:build T3 START', '2026-07-31 10:05 ds:build T3 DONE')
  await assertBothEnforcersAgree(ws, 'no', 'START and DONE on an identical target')
})

test('a second pending START after an earlier DONE is still open', async () => {
  const ws = fixtureWithStatusLog(
    '2026-07-31 10:00 ds:backprop pending START',
    '2026-07-31 10:05 ds:backprop B1 DONE',
    '2026-07-31 11:00 ds:backprop pending START',
  )
  await assertBothEnforcersAgree(ws, 'yes', 'a second pending START after an earlier DONE is still open')
})

test('two sequential backprops both resolved', async () => {
  const ws = fixtureWithStatusLog(
    '2026-07-31 10:00 ds:backprop pending START',
    '2026-07-31 10:05 ds:backprop B1 DONE',
    '2026-07-31 11:00 ds:backprop pending START',
    '2026-07-31 11:05 ds:backprop B2 DONE',
  )
  await assertBothEnforcersAgree(ws, 'no', 'two sequential backprops both resolved')
})

test('a DONE for an unrelated verb must not clear a pending START', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:backprop pending START', '2026-07-31 10:05 ds:build T3 DONE')
  await assertBothEnforcersAgree(ws, 'yes', 'a DONE for an unrelated verb must not clear a pending START')
})

test('an unclosed ds:close with the em-dash target close/SKILL.md mandates', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:close — START successor=— complete=true abandon=false')
  await assertBothEnforcersAgree(ws, 'yes', 'an unclosed ds:close with the em-dash target close/SKILL.md mandates')
})

test('the same ds:close, resolved', async () => {
  const ws = fixtureWithStatusLog('2026-07-31 10:00 ds:close — START successor=— complete=true abandon=false', '2026-07-31 10:05 ds:close — DONE')
  await assertBothEnforcersAgree(ws, 'no', 'the same ds:close, resolved')
})
