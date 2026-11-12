import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

function scaffold(status: string[]): { root: string; dir: string; clean: () => void } {
  const { dir: root, clean } = tempRoot('ds-new-finish-', true)
  const dir = join(root, '.scratchpad', 'dossier', '2026-11-12-demo')
  mkdirSync(dir, { recursive: true })
  const body = [
    '# demo',
    '',
    '`2026-11-12` · `live`',
    '',
    '## Goal',
    '',
    'demo',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    '| T1 | . | A | do it | — | | — |',
    '',
    '## Status',
    '',
    ...status.flatMap((line) => [line, '']),
    '## Closeout',
    '',
  ]
  writeFileSync(join(dir, 'DOSSIER.md'), body.join('\n'))
  return { root, dir, clean }
}

test('refuses a dossier with no signoff line', async () => {
  const { root, dir, clean } = scaffold(['2026-11-12 10:00 ds:new — created slug=demo'])
  try {
    const done = await ds(root, ['new-finish', dir])
    assert.equal(done.code, 1)
    assert.match(done.stderr, /ds:new signoff=/)
    assert.equal(readFileSync(join(dir, 'DOSSIER.md'), 'utf8').includes('ds:new — DONE'), false)
    assert.equal(existsSync(join(root, '.scratchpad', 'INDEX.md')), false)
  } finally {
    clean()
  }
})

test('finishes a dossier that has the signoff line', async () => {
  const { root, dir, clean } = scaffold(['2026-11-12 10:00 ds:new — created slug=demo', '2026-11-12 10:05 ds:new signoff=PASS notes=/tmp/notes.md'])
  try {
    const done = await ds(root, ['new-finish', dir])
    assert.equal(done.code, 0, done.stderr)
    assert.ok(readFileSync(join(dir, 'DOSSIER.md'), 'utf8').includes(`ds:new — DONE slug=demo dir=${dir}`))
    assert.match(readFileSync(join(root, '.scratchpad', 'INDEX.md'), 'utf8'), /\| 2026-11-12 \| demo \| live \|/)
    assert.match(done.stdout, /\/dossier:build/)
  } finally {
    clean()
  }
})
