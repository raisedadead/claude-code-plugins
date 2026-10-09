import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
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

function withWave(header: string, body: (root: string, dir: string, read: () => string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-migrate-'))
  const dir = join(root, '.scratchpad', 'dossier', '2026-06-01-old')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), ledger(header))
  try {
    body(root, dir, () => readFileSync(join(dir, 'DOSSIER.md'), 'utf8'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function ds(root: string, ...args: string[]) {
  return spawnSync('sh', [DS, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, DOSSIER_LEDGER_ROOT: root } })
}

test('the first write to a three-field ledger migrates its header and records the step', () => {
  withWave('`2026-06-01` · `live` · `P2/6`', (root, dir, read) => {
    const done = ds(root, 'row-flip', dir, 'T1', '~')
    assert.equal(done.status, 0, done.stderr)
    const text = read()
    assert.match(text, /^`2026-06-01` · `live`$/m)
    assert.match(text, /^\| T1 \| ~ \|/m)
    assert.match(text, /^\S+ \S+ ds:migrate — header-two-field$/m)
  })
})

test('a free-text third field survives as a status note', () => {
  withWave('`2026-06-01` · `paused` · `Pb` · warm-restart of `x`', (root, dir, read) => {
    assert.equal(ds(root, 'header-state', dir, 'live').status, 0)
    const text = read()
    assert.match(text, /^`2026-06-01` · `live`$/m)
    assert.match(text, /ds:migrate — header-two-field kept: `Pb` · warm-restart of `x`$/m)
  })
})

test('a two-field ledger writes no migrate line', () => {
  withWave('`2026-06-01` · `live`', (root, dir, read) => {
    assert.equal(ds(root, 's-append', dir, 'note').status, 0)
    assert.doesNotMatch(read(), /ds:migrate/)
    const again = ds(root, 'migrate', dir)
    assert.equal(again.status, 0, again.stderr)
    assert.equal(again.stdout, '')
  })
})

test('a header-shaped line under a section heading is not a header and does not migrate', () => {
  withWave('no header here', (root, dir, read) => {
    const path = join(dir, 'DOSSIER.md')
    writeFileSync(path, read().replace('## Tasks', '## Goal\n\n`foo` · `bar` · baz\n\n## Tasks'))
    const before = read()
    const done = ds(root, 'migrate', dir)
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.stdout, '')
    assert.equal(read(), before)
  })
})

test('a kept third field loses its semicolons so it cannot open a status op', () => {
  withWave('`2026-06-01` · `live` · note; START', (root, dir, read) => {
    assert.equal(ds(root, 'migrate', dir).status, 0)
    assert.match(read(), /ds:migrate — header-two-field kept: note, START$/m)
    assert.equal(ds(root, 'vm-checks', join(dir, 'DOSSIER.md')).stdout.includes('START without DONE'), false)
  })
})

test('a refused write leaves a legacy ledger untouched', () => {
  withWave('`2026-06-01` · `live` · `P1/1`', (root, dir, read) => {
    const before = read()
    assert.notEqual(ds(root, 'row-flip', dir, 'T1', 'z').status, 0)
    assert.equal(read(), before)
  })
})

test('ds migrate names what it changed and skips a locked wave', () => {
  withWave('`2026-06-01` · `live` · `P1/1`', (root, dir, read) => {
    writeFileSync(join(dir, '.ds-lock'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), skill: 'ds:build', target: 'T1' }))
    const before = read()
    const locked = ds(root, 'migrate', dir)
    assert.equal(locked.status, 1)
    assert.match(locked.stderr, /locked by ds:build/)
    assert.equal(read(), before)
    rmSync(join(dir, '.ds-lock'))
    const done = ds(root, 'migrate', dir)
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.stdout, `migrated ${dir}: header-two-field\n`)
    assert.match(read(), /^`2026-06-01` · `live`$/m)
  })
})
