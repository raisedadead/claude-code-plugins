import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds as inproc } from './inproc.ts'

const TASKS = ['| id | state | who | task | needs | cite | verify |', '|----|-------|-----|------|-------|------|--------|', '| T1 | . | A | t | — | — | v |']

function ledger(header: string): string {
  return [
    '# old',
    '',
    header,
    '',
    '## Tasks',
    '',
    ...TASKS,
    '',
    '## Status',
    '',
    '2026-06-01 09:00 ds:new — created slug=old',
    '',
    '## Closeout',
    '',
    '_(empty)_',
    '',
  ].join('\n')
}

async function withWave(header: string, body: (root: string, dir: string, read: () => string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ds-migrate-'))
  const dir = join(root, '.scratchpad', 'dossier', '2026-06-01-old')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), ledger(header))
  try {
    await body(root, dir, () => readFileSync(join(dir, 'DOSSIER.md'), 'utf8'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function ds(root: string, ...args: string[]) {
  return inproc(root, args, { DOSSIER_LEDGER_ROOT: root })
}

test('the first write to a three-field ledger migrates its header and records the step', async () => {
  await withWave('`2026-06-01` · `live` · `P2/6`', async (root, dir, read) => {
    const done = await ds(root, 'row-flip', dir, 'T1', '~')
    assert.equal(done.code, 0, done.stderr)
    const text = read()
    assert.match(text, /^`2026-06-01` · `live`$/m)
    assert.match(text, /^\| T1 \| ~ \|/m)
    assert.match(text, /^\S+ \S+ ds:migrate — header-two-field$/m)
  })
})

test('a free-text third field survives as a status note', async () => {
  await withWave('`2026-06-01` · `paused` · `Pb` · warm-restart of `x`', async (root, dir, read) => {
    assert.equal((await ds(root, 'header-state', dir, 'live')).code, 0)
    const text = read()
    assert.match(text, /^`2026-06-01` · `live`$/m)
    assert.match(text, /ds:migrate — header-two-field kept: `Pb` · warm-restart of `x`$/m)
  })
})

test('a two-field ledger writes no migrate line', async () => {
  await withWave('`2026-06-01` · `live`', async (root, dir, read) => {
    assert.equal((await ds(root, 's-append', dir, 'note')).code, 0)
    assert.doesNotMatch(read(), /ds:migrate/)
    const again = await ds(root, 'migrate', dir)
    assert.equal(again.code, 0, again.stderr)
    assert.equal(again.stdout, '')
  })
})

test('a header-shaped line under a section heading is not a header and does not migrate', async () => {
  await withWave('no header here', async (root, dir, read) => {
    const path = join(dir, 'DOSSIER.md')
    writeFileSync(path, read().replace('## Tasks', '## Goal\n\n`foo` · `bar` · baz\n\n## Tasks'))
    const before = read()
    const done = await ds(root, 'migrate', dir)
    assert.equal(done.code, 0, done.stderr)
    assert.equal(done.stdout, '')
    assert.equal(read(), before)
  })
})

test('a kept third field loses its semicolons so it cannot open a status op', async () => {
  await withWave('`2026-06-01` · `live` · note; START', async (root, dir, read) => {
    assert.equal((await ds(root, 'migrate', dir)).code, 0)
    assert.match(read(), /ds:migrate — header-two-field kept: note, START$/m)
    assert.equal((await ds(root, 'vm-checks', join(dir, 'DOSSIER.md'))).stdout.includes('START without DONE'), false)
  })
})

test('a refused write leaves a legacy ledger untouched', async () => {
  await withWave('`2026-06-01` · `live` · `P1/1`', async (root, dir, read) => {
    const before = read()
    assert.notEqual((await ds(root, 'row-flip', dir, 'T1', 'z')).code, 0)
    assert.equal(read(), before)
  })
})

test('ds migrate names what it changed and skips a locked wave', async () => {
  await withWave('`2026-06-01` · `live` · `P1/1`', async (root, dir, read) => {
    writeFileSync(join(dir, '.ds-lock'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), skill: 'ds:build', target: 'T1' }))
    const before = read()
    const locked = await ds(root, 'migrate', dir)
    assert.equal(locked.code, 1)
    assert.match(locked.stderr, /locked by ds:build/)
    assert.equal(read(), before)
    rmSync(join(dir, '.ds-lock'))
    const done = await ds(root, 'migrate', dir)
    assert.equal(done.code, 0, done.stderr)
    assert.equal(done.stdout, `migrated ${dir}: header-two-field\n`)
    assert.match(read(), /^`2026-06-01` · `live`$/m)
  })
})
