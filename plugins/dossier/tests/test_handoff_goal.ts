import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { clock } from '../cli/clock.ts'
import { ds, tempRoot } from './inproc.ts'

const realNow = clock.now

function nextSecond(): void {
  clock.now = () => new Date(Date.now() + 1000)
}

const SECONDS = /^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) /

let home = ''
let dir = ''
let clean = (): void => {}

beforeEach(() => {
  const made = tempRoot('ds-handoff-goal-')
  clean = made.clean
  home = made.dir
  dir = join(made.dir, '.scratchpad', 'dossier', '2026-11-12-demo')
  mkdirSync(dir, { recursive: true })
})

afterEach(() => {
  clock.now = realNow
  clean()
})

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
  const done = await ds(home, ['handoff', dir])
  assert.equal(done.code, 0, done.stderr)
  const line = done.stdout.split('\n').find((text) => text.startsWith('/goal '))
  assert.ok(line, done.stdout)
  return line
}

test('s-append prints the line it wrote, stamped to the second', async () => {
  ledger(['| T1 | . | A | a | — | — | v |'])
  const done = await ds(home, ['s-append', dir, 'ds:build T1 START'])
  const printed = done.stdout.trim()
  assert.match(printed, SECONDS)
  assert.ok(readFileSync(join(dir, 'DOSSIER.md'), 'utf8').split('\n').includes(printed), printed)
})

test('the goal is met by a stop line s-append prints after the handoff', async () => {
  ledger(['| T1 | . | A | a | — | — | v |'])
  const condition = await goal()
  assert.ok(condition.includes('demo'), condition)
  nextSecond()
  const pause = (await ds(home, ['s-append', dir, 'ds:build T1 PAUSE reason=push:main'])).stdout.trim()
  const stop = (await ds(home, ['s-append', dir, 'ds:build — auto-stop=no-unblocked'])).stdout.trim()
  assert.ok(satisfies(condition, pause), `${condition}\n${pause}`)
  assert.ok(satisfies(condition, stop), `${condition}\n${stop}`)
})

async function lines(...events: string[]): Promise<string[]> {
  for (const event of events) assert.equal((await ds(home, ['s-append', dir, event])).code, 0)
  const done = await ds(home, ['handoff', dir])
  assert.equal(done.code, 0, done.stderr)
  return done.stdout.trim().split('\n')
}

const isGoal = (line: string): boolean => line.startsWith('/goal ')

test('an agent row paused on a non-CI reason names the reason and gets no goal', async () => {
  for (const state of ['.', '~']) {
    ledger(['| T1 | x | A | a | — | c | v |', `| T2 | ${state} | A | b | T1 | — | v |`])
    const out = await lines('ds:build T2 PAUSE reason=push:not pushed')
    assert.ok(!out.some(isGoal), out.join('\n'))
    const answer = out.filter((line) => line.startsWith('answer: T2 '))
    assert.equal(answer.length, 1, out.join('\n'))
    assert.ok(answer[0]?.includes('push:not pushed'), out.join('\n'))
  }
})

test('a paused row beside a runnable agent row keeps the goal', async () => {
  ledger(['| T1 | . | A | a | — | — | v |', '| T2 | . | A | b | — | — | v |'])
  const out = await lines('ds:build T2 PAUSE reason=ambiguous:two readings')
  assert.ok(
    out.some((line) => line.startsWith('answer: T2 ') && line.includes('ambiguous:two readings')),
    out.join('\n'),
  )
  assert.ok(out.some(isGoal), out.join('\n'))
})

test('a paused row is named before the operator step that the next agent row waits on', async () => {
  ledger(['| T1 | . | A | a | — | — | v |', '| T2 | . | H | Push main | — | — | v |', '| T3 | . | A | c | T2 | — | v |'])
  const out = await lines('ds:build T1 PAUSE reason=push:main')
  assert.ok(
    out.some((line) => line.startsWith('answer: T1 ')),
    out.join('\n'),
  )
  assert.ok(
    out.some((line) => line.startsWith('after: T2 ')),
    out.join('\n'),
  )
  assert.ok(out.some(isGoal), out.join('\n'))
})

test('a budget pause leaves the row to resume under a goal', async () => {
  ledger(['| T1 | x | A | a | — | c | v |', '| T2 | ~ | A | b | T1 | — | v |'])
  const out = await lines('ds:build T2 PAUSE reason=budget:context full')
  assert.ok(!out.some((line) => line.startsWith('answer:')), out.join('\n'))
  assert.ok(out.some(isGoal), out.join('\n'))
})

test('a pause on a done row, or one followed by a later event, adds no answer line', async () => {
  ledger(['| T1 | x | A | a | — | c | v |', '| T2 | ~ | A | b | T1 | — | v |'])
  const out = await lines('ds:build T1 PAUSE reason=push:main', 'ds:build T2 PAUSE reason=push:main', 'ds:build T2 START')
  assert.ok(!out.some((line) => line.startsWith('answer:')), out.join('\n'))
  assert.ok(out.some(isGoal), out.join('\n'))
})

test('a blocked row with a pause gets one answer line', async () => {
  ledger(['| T1 | ! | A | a | — | — | v |'])
  const out = await lines('ds:build T1 PAUSE reason=blocked:needs ops review')
  assert.equal(out.filter((line) => line.startsWith('answer: T1 ')).length, 1, out.join('\n'))
  assert.ok(!out.some(isGoal), out.join('\n'))
})

test('the goal is not met by a stop line from before the handoff or by a non-stop line', async () => {
  ledger(['| T1 | x | A | a | — | c | v |', '| T2 | . | A | b | T1 | — | v |'], ['2026-11-12 09:05:00 ds:build T1 PAUSE reason=push:main'])
  const condition = await goal()
  assert.ok(!satisfies(condition, '2026-11-12 09:05:00 ds:build T1 PAUSE reason=push:main'), condition)
  nextSecond()
  const start = (await ds(home, ['s-append', dir, 'ds:build T1 START'])).stdout.trim()
  assert.ok(!satisfies(condition, start), `${condition}\n${start}`)
})
