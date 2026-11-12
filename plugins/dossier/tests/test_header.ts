import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds as inproc } from './inproc.ts'

const SECTIONS = ['Goal', 'Constraints', 'Interfaces', 'Invariants', 'Tasks', 'Bugs', 'Repos', 'Status', 'Closeout']
const LEDGER = ['# two', '', '`2026-10-08` · `live`', '', ...SECTIONS.flatMap((name) => [`## ${name}`, '', '_(empty)_', '']), ''].join('\n')

async function withWave(body: (root: string, dir: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'ds-header-'))
  const dir = join(root, '.scratchpad', 'dossier', '2026-10-09-two')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), LEDGER)
  try {
    await body(root, dir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function ds(root: string, ...args: string[]) {
  return inproc(root, args, { DOSSIER_LEDGER_ROOT: root })
}

test('a two-field header passes assert-scaffold and reads as live in the INDEX', async () => {
  await withWave(async (root, dir) => {
    assert.match(LEDGER, /^`2026-10-08` · `live`$/m)
    const scaffold = await ds(root, 'assert-scaffold', dir)
    assert.equal(scaffold.code, 0, scaffold.stderr)
    assert.equal((await ds(root, 'regen-index')).code, 0)
    assert.match(readFileSync(join(root, '.scratchpad', 'INDEX.md'), 'utf8'), /\| two \| live \|/)
    assert.match((await ds(root, 'progress', '--line')).stdout, /^two /m)
  })
})

test('header-state rewrites the token of a two-field header', async () => {
  await withWave(async (root, dir) => {
    const done = await ds(root, 'header-state', dir, 'paused')
    assert.equal(done.code, 0, done.stderr)
    assert.match(readFileSync(join(dir, 'DOSSIER.md'), 'utf8'), /^`2026-10-08` · `paused`$/m)
  })
})
