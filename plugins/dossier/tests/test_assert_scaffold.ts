import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function root(): string {
  const { dir, clean } = tempRoot('dossier-scaffold-')
  cleanups.push(clean)
  mkdirSync(join(dir, '.scratchpad', 'dossier'), { recursive: true })
  return dir
}

const FULL = [
  '# demo-slug',
  '',
  '`2026-07-07` · `live` · `P1/1`',
  '',
  '## §G — Goal',
  '',
  'do the thing',
  '',
  '## §C — Constraints',
  '',
  'none',
  '',
  '## §I — Interfaces',
  '',
  '_(empty)_',
  '',
  '## §V — Invariants',
  '',
  '| id | invariant | check |',
  '|----|-----------|-------|',
  '',
  '## §T — Task ledger',
  '',
  '| id | P | state | task | cite | verify |',
  '|----|---|-------|------|------|--------|',
  '',
  '## §B — Bug ledger',
  '',
  '| id | bug | root cause | invariant added | fix cite |',
  '|----|-----|------------|-----------------|----------|',
  '',
  '## §X — Cross-repo state',
  '',
  '| repo | branch | ahead | tag | pushed | notes |',
  '|------|--------|-------|-----|--------|-------|',
  '',
  '## §S — Rolling status log',
  '',
  '2026-07-07 12:00 ds:new — created slug=demo-slug phase=P1',
  '',
  '## §Z — Closeout',
  '',
  '_(empty)_',
  '',
]

const WORDED = [
  '# demo-slug',
  '',
  '`2026-08-05` · `live` · `P1/1`',
  '',
  '## Goal',
  '',
  'do the thing',
  '',
  'Scope:',
  '',
  '- one thing',
  '',
  '## Constraints',
  '',
  '- none',
  '',
  '## Interfaces',
  '',
  '_(empty — populate when first contract lands)_',
  '',
  '## Invariants',
  '',
  '| id | invariant | check |',
  '|----|-----------|-------|',
  '',
  '## Tasks',
  '',
  '| id | state | who | task | needs | cite | verify |',
  '|----|-------|-----|------|-------|------|--------|',
  '',
  '## Bugs',
  '',
  '| id | bug | root cause | invariant added | fix cite |',
  '|----|-----|------------|-----------------|----------|',
  '',
  '## Repos',
  '',
  '| repo | branch | ahead | tag | pushed | notes |',
  '|------|--------|-------|-----|--------|-------|',
  '',
  '## Status',
  '',
  '2026-08-05 12:00 ds:new — created slug=demo-slug',
  '',
  '## Closeout',
  '',
  '_(empty — written by ds:close)_',
  '',
]

const SIGIL_SECTIONS: [string, string][] = [
  ['## §G — Goal', 'Goal'],
  ['## §C — Constraints', 'Constraints'],
  ['## §I — Interfaces', 'Interfaces'],
  ['## §V — Invariants', 'Invariants'],
  ['## §T — Task ledger', 'Tasks'],
  ['## §B — Bug ledger', 'Bugs'],
  ['## §X — Cross-repo state', 'Repos'],
  ['## §S — Rolling status log', 'Status'],
  ['## §Z — Closeout', 'Closeout'],
]

const WORDED_SECTIONS: [string, string][] = [
  ['## Goal', 'Goal'],
  ['## Constraints', 'Constraints'],
  ['## Interfaces', 'Interfaces'],
  ['## Invariants', 'Invariants'],
  ['## Tasks', 'Tasks'],
  ['## Bugs', 'Bugs'],
  ['## Repos', 'Repos'],
  ['## Status', 'Status'],
  ['## Closeout', 'Closeout'],
]

function write(dir: string, rows: string[]): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), rows.join('\n'))
}

function without(rows: string[], line: string): string[] {
  return rows.filter((row) => row !== line)
}

async function assertSectionRequired(cwd: string, rows: string[], name: string, heading: string, tag: string): Promise<void> {
  const dir = join(cwd, `req-${name}-${rows.indexOf(heading)}`)
  write(dir, without(rows, heading))
  const done = await ds(cwd, ['assert-scaffold', dir])
  assert.notEqual(done.code, 0, `dropping '${heading}' must exit non-zero`)
  assert.ok(`${done.stdout}${done.stderr}`.includes(tag), `error for dropped '${heading}' must name ${tag}`)
}

test('a full scaffold passes as a dir, a file and a dir with a trailing slash', async () => {
  const cwd = root()
  const dir = join(cwd, '2026-07-07-happy')
  write(dir, FULL)
  assert.equal((await ds(cwd, ['assert-scaffold', dir])).code, 0, 'full scaffold (dir arg) must exit 0')
  assert.equal((await ds(cwd, ['assert-scaffold', join(dir, 'DOSSIER.md')])).code, 0, 'full scaffold (file arg) must exit 0')
  assert.equal((await ds(cwd, ['assert-scaffold', `${dir}/`])).code, 0, 'full scaffold (dir arg, trailing slash) must exit 0')
})

test('the worded scaffold as ds:new writes it passes', async () => {
  const cwd = root()
  const dir = join(cwd, '2026-08-05-worded')
  write(dir, WORDED)
  assert.equal((await ds(cwd, ['assert-scaffold', dir])).code, 0, 'worded scaffold as ds:new writes it must exit 0')
})

test('dropping any sigil section heading fails and names the section', async () => {
  const cwd = root()
  for (const [heading, tag] of SIGIL_SECTIONS) await assertSectionRequired(cwd, FULL, 'full', heading, tag)
})

test('dropping any worded section heading fails and names the section', async () => {
  const cwd = root()
  for (const [heading, tag] of WORDED_SECTIONS) await assertSectionRequired(cwd, WORDED, 'worded', heading, tag)
})

test('a missing title fails', async () => {
  const cwd = root()
  const dir = join(cwd, '2026-07-07-notitle')
  write(dir, without(FULL, '# demo-slug'))
  assert.notEqual((await ds(cwd, ['assert-scaffold', dir])).code, 0, 'missing title must exit non-zero')
})

test('a missing DOSSIER.md fails', async () => {
  const cwd = root()
  assert.notEqual((await ds(cwd, ['assert-scaffold', join(cwd, 'nope')])).code, 0, 'missing DOSSIER.md must exit non-zero')
})
