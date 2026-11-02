import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function ledgerWith(row: string): string {
  const { dir, clean } = tempRoot('ds-inproc-')
  cleanups.push(clean)
  mkdirSync(join(dir, '.scratchpad', 'dossier'), { recursive: true })
  writeFileSync(join(dir, '.scratchpad', 'dossier', 'LATER.md'), `# Carried work\n\n- ${row} · a task · H\n`)
  return dir
}

test('a run puts back the cwd, PWD and both ledger roots it found', async () => {
  const before = [process.cwd(), process.env.PWD, process.env.DOSSIER_LEDGER_ROOT, process.env.DOSSIER_SCRATCHPAD_ROOT]
  const done = await ds(ledgerWith('w/T1'), ['later'])
  assert.equal(done.code, 0, done.stderr)
  assert.deepEqual([process.cwd(), process.env.PWD, process.env.DOSSIER_LEDGER_ROOT, process.env.DOSSIER_SCRATCHPAD_ROOT], before)
})

test('a second run in another ledger reads its own ledger, not the first one', async () => {
  const first = await ds(ledgerWith('first/T1'), ['later'])
  const second = await ds(ledgerWith('second/T1'), ['later'])
  assert.match(first.stdout, /^first\/T1 · /)
  assert.match(second.stdout, /^second\/T1 · /)
})

test('stdout and stderr are captured apart, with the exit code', async () => {
  const done = await ds(ledgerWith('w/T1'), ['later', 'drop'])
  assert.equal(done.code, 64)
  assert.equal(done.stdout, '')
  assert.match(done.stderr, /usage: ds later/)
})
