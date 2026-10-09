import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const SECTIONS = ['Goal', 'Constraints', 'Interfaces', 'Invariants', 'Tasks', 'Bugs', 'Repos', 'Status', 'Closeout']
const LEDGER = ['# two', '', '`2026-10-08` · `live`', '', ...SECTIONS.flatMap((name) => [`## ${name}`, '', '_(empty)_', '']), ''].join('\n')

function withWave(body: (root: string, dir: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-header-'))
  const dir = join(root, '.scratchpad', 'dossier', '2026-10-09-two')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), LEDGER)
  try {
    body(root, dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function ds(root: string, ...args: string[]) {
  return spawnSync('sh', [DS, ...args], { cwd: root, encoding: 'utf8', env: { ...process.env, DOSSIER_LEDGER_ROOT: root } })
}

test('a two-field header passes assert-scaffold and reads as live in the INDEX', () => {
  withWave((root, dir) => {
    assert.match(LEDGER, /^`2026-10-08` · `live`$/m)
    const scaffold = ds(root, 'assert-scaffold', dir)
    assert.equal(scaffold.status, 0, scaffold.stderr)
    assert.equal(ds(root, 'regen-index').status, 0)
    assert.match(readFileSync(join(root, '.scratchpad', 'INDEX.md'), 'utf8'), /\| two \| live \|/)
    assert.match(ds(root, 'progress', '--line').stdout, /^two /m)
  })
})

test('header-state rewrites the token of a two-field header', () => {
  withWave((root, dir) => {
    const done = ds(root, 'header-state', dir, 'paused')
    assert.equal(done.status, 0, done.stderr)
    assert.match(readFileSync(join(dir, 'DOSSIER.md'), 'utf8'), /^`2026-10-08` · `paused`$/m)
  })
})
