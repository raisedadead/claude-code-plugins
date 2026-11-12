import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const SECONDS = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) /

let dir = ''
let clean = (): void => {}

beforeEach(() => {
  const made = tempRoot('ds-handoff-goal-')
  clean = made.clean
  dir = join(made.dir, '.scratchpad', 'dossier', '2026-11-12-demo')
  mkdirSync(dir, { recursive: true })
})

afterEach(() => clean())

function ledger(rows: string[], status: string[] = []): void {
  const text = [
    '# demo',
    '',
    '`2026-11-12` · `live`',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    ...rows,
    '',
    '## Status',
    '',
    '2026-11-12 09:00 ds:new — created slug=demo',
    '',
    ...status.flatMap((line) => [line, '']),
    '## Closeout',
    '',
  ]
  writeFileSync(join(dir, 'DOSSIER.md'), text.join('\n'))
}

function satisfies(goal: string, line: string): boolean {
  const after = /stamped after (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\.$/.exec(goal)?.[1]
  const stamp = SECONDS.exec(line)?.[1]
  return after !== undefined && stamp !== undefined && stamp > after && / ds:build (\S+ PAUSE|— auto-stop)/.test(line)
}

async function goal(): Promise<string> {
  const done = await ds(dir, ['handoff', dir])
  assert.equal(done.code, 0, done.stderr)
  const line = done.stdout.split('\n').find((text) => text.startsWith('/goal '))
  assert.ok(line, done.stdout)
  return line
}

test('s-append prints the line it wrote, stamped to the second', async () => {
  ledger(['| T1 | . | A | a | — | — | v |'])
  const done = await ds(dir, ['s-append', dir, 'ds:build T1 START'])
  const printed = done.stdout.trim()
  assert.match(printed, SECONDS)
  assert.ok(readFileSync(join(dir, 'DOSSIER.md'), 'utf8').split('\n').includes(printed), printed)
})

test('the goal is met by a stop line s-append prints after the handoff', async () => {
  ledger(['| T1 | . | A | a | — | — | v |'])
  const condition = await goal()
  assert.ok(condition.includes('demo'), condition)
  await sleep(1100)
  const pause = (await ds(dir, ['s-append', dir, 'ds:build T1 PAUSE reason=push:main'])).stdout.trim()
  const stop = (await ds(dir, ['s-append', dir, 'ds:build — auto-stop=no-unblocked'])).stdout.trim()
  assert.ok(satisfies(condition, pause), `${condition}\n${pause}`)
  assert.ok(satisfies(condition, stop), `${condition}\n${stop}`)
})

test('the goal is not met by a stop line from before the handoff or by a non-stop line', async () => {
  ledger(['| T1 | . | A | a | — | — | v |'], ['2026-11-12 09:05:00 ds:build T1 PAUSE reason=push:main'])
  const condition = await goal()
  assert.ok(!satisfies(condition, '2026-11-12 09:05:00 ds:build T1 PAUSE reason=push:main'), condition)
  await sleep(1100)
  const start = (await ds(dir, ['s-append', dir, 'ds:build T1 START'])).stdout.trim()
  assert.ok(!satisfies(condition, start), `${condition}\n${start}`)
})
