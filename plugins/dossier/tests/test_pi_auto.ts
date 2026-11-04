import { expect, test } from 'vitest'
import type { AgentBeforeSettleEvent } from '@earendil-works/pi-coding-agent'
import { createAutoDriver } from '../pi/auto.ts'
import type { Io } from '../hooks/gates.ts'

const dir = '/project/.scratchpad/dossier/2026-11-04-work'
const ledger = (rows = '| T1 | . | A | implement | — | — | true |', log = '') =>
  '`2026-11-04` · `live`\n\n## §T Tasks\n| id | state | who | task | needs | cite | verify |\n| --- | --- | --- | --- | --- | --- | --- |\n' +
  rows +
  '\n\n## §S Status\n' +
  log
function fixture(text = ledger()) {
  const files = new Map([[dir + '/DOSSIER.md', text]])
  const io: Io = {
    list: async () => ['2026-11-04-work'],
    isDir: async () => true,
    exists: async (p) => files.has(p),
    read: async (p) => {
      const found = files.get(p)
      if (found === undefined) throw new Error('missing')
      return found
    },
    env: async () => undefined,
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
  }
  return { io, files, driver: createAutoDriver() }
}
const prior = { type: 'custom_message' as const, customType: 'other', content: 'keep', display: false }
const event = { outcome: 'completed', continue: false, entries: [prior] } as AgentBeforeSettleEvent

test('driver is off until started and preserves another extension continuation', async () => {
  const f = fixture()
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
  await f.driver.start(f.io, '/project', 'work')
  expect(await f.driver.settle(f.io, { ...event, continue: true })).toBeUndefined()
  const result = await f.driver.settle(f.io, event)
  expect(result?.continue).toBe(true)
  expect(result?.entries?.[0]).toEqual(prior)
})
test('no progress gets only one retry before a stop explanation, then no loop', async () => {
  const f = fixture()
  await f.driver.start(f.io, '/project', 'work')
  expect((await f.driver.settle(f.io, event))?.continue).toBe(true)
  expect(JSON.stringify(await f.driver.settle(f.io, event))).toContain('no ledger progress')
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
})
test('completed rows, operator-owned work and blocked frontiers stop without another task', async () => {
  for (const row of ['| T1 | x | A | done | — | abc | true |', '| T1 | . | H | decide | — | — | — |', '| T1 | ! | A | blocked | — | — | true |']) {
    const f = fixture(ledger(row))
    await f.driver.start(f.io, '/project', 'work')
    expect(await f.driver.settle(f.io, event)).toBeUndefined()
  }
})
test('a new PAUSE/auto-stop is respected but historical lines are not mistaken for new stops', async () => {
  const f = fixture(ledger(undefined, '2026-11-03 12:00 ds:build T1 PAUSE reason=review:old\n'))
  await f.driver.start(f.io, '/project', 'work')
  expect((await f.driver.settle(f.io, event))?.continue).toBe(true)
  f.files.set(
    dir + '/DOSSIER.md',
    ledger(undefined, '2026-11-03 12:00 ds:build T1 PAUSE reason=review:old\n\n2026-11-04 01:00 ds:build T1 PAUSE reason=ambiguous:new\n'),
  )
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
})
test('aborts, resets and unreadable ledgers cannot continue', async () => {
  const f = fixture()
  await f.driver.start(f.io, '/project', 'work')
  expect(await f.driver.settle(f.io, { ...event, outcome: 'aborted' })).toBeUndefined()
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
  await f.driver.start(f.io, '/project', 'work')
  f.driver.reset()
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
  await f.driver.start(f.io, '/project', 'work')
  f.files.clear()
  expect((await f.driver.settle(f.io, event))?.continue).toBe(true)
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
})
test('unsafe or ambiguous wave names cannot arm the driver', async () => {
  const f = fixture()
  await expect(f.driver.start(f.io, '/project', '../work')).rejects.toThrow()
  await expect(f.driver.start(f.io, '/project', 'missing')).rejects.toThrow()
})
test('a session reset during an asynchronous start cannot arm a stale driver', async () => {
  const f = fixture()
  let release!: () => void
  const waiting = new Promise<void>((done) => {
    release = done
  })
  const read = f.io.read
  f.io.read = async (path) => {
    await waiting
    return read(path)
  }
  const started = f.driver.start(f.io, '/project', 'work')
  f.driver.reset()
  release()
  await expect(started).rejects.toThrow(/cancelled/)
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
})

test('concurrent starts cannot replace a pending wave selection', async () => {
  const f = fixture()
  let release!: () => void
  const waiting = new Promise<void>((done) => {
    release = done
  })
  const read = f.io.read
  f.io.read = async (path) => {
    await waiting
    return read(path)
  }
  const first = f.driver.start(f.io, '/project', 'work')
  const second = f.driver.start(f.io, '/project', 'work')
  const rejected = expect(second).rejects.toThrow(/already/)
  release()
  await first
  await rejected
})

test('task budget is computed from completed rows, not a model DONE claim', async () => {
  const f = fixture(ledger('| T1 | . | A | first | — | — | true |\n| T2 | . | A | next | T1 | — | true |'))
  await f.driver.start(f.io, '/project', 'work', 1)
  f.files.set(dir + '/DOSSIER.md', ledger('| T1 | x | A | first | — | abc | true |\n| T2 | . | A | next | T1 | — | true |'))
  expect(JSON.stringify(await f.driver.settle(f.io, event))).toContain('task budget')
  expect(await f.driver.settle(f.io, event)).toBeUndefined()
})
