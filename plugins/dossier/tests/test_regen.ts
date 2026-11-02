import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function root(): string {
  const { dir, clean } = tempRoot('dossier-regen-')
  cleanups.push(clean)
  return dir
}

function put(ws: string, rel: string, lines: readonly string[]): void {
  const dir = join(ws, '.scratchpad', 'dossier', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), `${lines.join('\n')}\n`)
}

function makeDossier(ws: string, rel: string, token: string, zbody = '_(empty — written by ds:close)_'): void {
  put(ws, rel, [
    `\`2026-06-01\` · \`${token}\` · \`P1/1\``,
    '',
    '## §T — Task ledger',
    '',
    '| id  | P   | state | task    | cite | verify |',
    '| --- | --- | ----- | ------- | ---- | ------ |',
    '| T1  | P1  | x     | do it   | [a1] | V1     |',
    '',
    '## §B — Bug ledger',
    '',
    '| id  | bug | root cause | invariant added | fix cite |',
    '| --- | --- | ---------- | --------------- | -------- |',
    '',
    '## §X — Cross-repo state',
    '',
    '| repo | branch | ahead | tag | pushed | notes |',
    '| ---- | ------ | ----- | --- | ------ | ----- |',
    '',
    '## §S — Rolling status log',
    '',
    '2026-06-01 10:00 ds:new — created',
    '',
    '## §Z — Closeout',
    '',
    zbody,
  ])
}

function indexOf(ws: string): string {
  return join(ws, '.scratchpad', 'INDEX.md')
}

function indexText(ws: string): string {
  return readFileSync(indexOf(ws), 'utf8')
}

function cell(ws: string, slug: string, column: number): string {
  const pattern = new RegExp(slug)
  for (const line of indexText(ws).split('\n').slice(2)) {
    const fields = line.split('|')
    if (pattern.test(fields[2] ?? '')) return (fields[column - 1] ?? '').trim()
  }
  return ''
}

function stateOf(ws: string, slug: string): string {
  return cell(ws, slug, 4)
}

function zOf(ws: string, slug: string): string {
  return cell(ws, slug, 8)
}

async function regen(ws: string): Promise<void> {
  const done = await ds(ws, ['regen-index', '.scratchpad'])
  assert.equal(done.code, 0, done.stderr)
}

test('regen renders concordant states, surfaces every drift, and leaves no orphan', async () => {
  const ws = root()
  makeDossier(ws, '2026-06-10-awake', 'live')
  makeDossier(ws, '2026-06-10-samedrift', 'done')
  makeDossier(ws, '2026-06-09-idle-ok', 'paused')
  makeDossier(ws, '2026-06-08-zombie', 'done')
  makeDossier(ws, '2026-06-07-sealed', 'sealed')
  makeDossier(ws, '2026-06-06-closeout-noarch', 'live', 'complete: true')
  makeDossier(ws, '_archive/2026-06-05-gone', 'done', 'complete: true')
  makeDossier(ws, '_archive/2026-06-04-inverse', 'live', 'complete: true')
  makeDossier(ws, '_archive/2026-06-03-legacy', 'done')
  await regen(ws)

  assert.ok(existsSync(indexOf(ws)), 'regen produced no INDEX')

  assert.equal(stateOf(ws, 'awake'), 'live', 'concordant live must render live')
  assert.equal(stateOf(ws, 'idle-ok'), 'paused', 'concordant paused must render paused')
  assert.equal(stateOf(ws, 'gone'), 'done', 'concordant archived must render done')
  assert.equal(stateOf(ws, 'legacy'), 'done', 'archived done-header w/ prose-only §Z (no machine key) must render done — location+header suffice')

  assert.equal(stateOf(ws, 'zombie'), 'drift!', 'done-header non-archived must render drift!')
  assert.equal(stateOf(ws, 'sealed'), 'drift!', 'non-canonical token must render drift!')
  assert.equal(stateOf(ws, 'closeout-noarch'), 'drift!', '§Z-closed non-archived must render drift!')
  assert.equal(stateOf(ws, 'inverse'), 'drift!', 'archived live-header must render drift!')

  const leaked = indexText(ws)
    .split('\n')
    .filter((line) => line.startsWith('|'))
    .map((line) => line.split('|'))
    .filter((fields) => (fields[3] ?? '').trim() === 'live')
    .map((fields) => (fields[2] ?? '').trim())
    .filter((slug) => /zombie|sealed|inverse|closeout-noarch/.test(slug))
  assert.deepEqual(leaked, [], 'a drift dir leaked into a live state cell')

  assert.equal(stateOf(ws, 'samedrift'), 'drift!', 'same-date done-header must render drift!')

  assert.ok(/<!-- drift:5/.test(indexText(ws)), 'INDEX missing drift trailer count=5')

  const lines = indexText(ws).split('\n')
  const drift = lines.findIndex((line) => line.includes('| samedrift '))
  const alive = lines.findIndex((line) => line.includes('| awake '))
  assert.ok(drift >= 0 && alive >= 0 && drift < alive, `drift! must sort above live within the same date (drift@${drift} live@${alive})`)

  const orphans = readdirSync(join(ws, '.scratchpad'), { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('.tmp') || /(^|\/)INDEX\.md\..{6}/.test(name))
  assert.deepEqual(orphans, [], 'regen left a tmp orphan')
})

test('a clean tree emits no drift trailer', async () => {
  const ws = root()
  put(ws, '2026-06-01-clean', [
    '`2026-06-01` · `live` · `P1/1`',
    '',
    '## §T',
    '',
    '| id | P  | state | task | cite | verify |',
    '| -- | -- | ----- | ---- | ---- | ------ |',
    '| T1 | P1 | .     | x    | —    | —      |',
    '',
    '## §Z — Closeout',
    '',
    '_(empty)_',
  ])
  await regen(ws)
  assert.ok(!/<!-- drift:/.test(indexText(ws)), 'clean tree must not emit a drift trailer')
})

test('a §Z with trailing punctuation reads closed', async () => {
  const ws = root()
  put(ws, '2026-06-01-punct', ['`2026-06-01` · `live` · `P1/1`', '', '## §Z — Closeout', '', 'complete: true.'])
  await regen(ws)
  assert.equal(stateOf(ws, 'punct'), 'drift!', "§Z 'complete: true.' (trailing punctuation) must read closed → drift! (regen/reconcile predicate parity)")
})

async function layoutRow(ws: string, header: string, sep: string, r1: string, r2: string): Promise<string> {
  put(ws, '2026-08-04-shape', ['`2026-08-04` · `live` · `P1/1`', '', '## §T — Task ledger', '', header, sep, r1, r2, '', '## §Z — Closeout', '', '_(empty)_'])
  await regen(ws)
  return indexText(ws)
    .split('\n')
    .filter((line) => line.includes('shape'))
    .map((line) => (line.split('|')[4] ?? '').replaceAll(' ', ''))
    .join('\n')
}

test('the done count is read by header name, so both §T layouts agree', async () => {
  const legacy = await layoutRow(
    root(),
    '| id  | P   | state | task | cite | verify |',
    '| --- | --- | ----- | ---- | ---- | ------ |',
    '| T1  | P1  | x     | a    | [a1] | V1     |',
    '| T2  | P1  | .     | b    | —    | —      |',
  )
  const shaped = await layoutRow(
    root(),
    '| id  | state | who | task | needs | cite | verify |',
    '| --- | ----- | --- | ---- | ----- | ---- | ------ |',
    '| T1  | x     | A   | a    | —     | [a1] | V1     |',
    '| T2  | .     | A   | b    | T1    | —    | —      |',
  )
  assert.equal(legacy, shaped, `the done count is read by header name, so both §T layouts must agree; legacy=${legacy} who/needs=${shaped}`)
  assert.equal(shaped, '1/2', `one of two rows is x, so the who/needs layout must count 1/2, got ${shaped}`)
})

test('a Tasks header naming no state column is reported', async () => {
  const ws = root()
  put(ws, '2026-08-05-nostate', [
    '`2026-08-05` · `live` · `P1/1`',
    '',
    '## Tasks',
    '',
    '| id | status | owner | task |',
    '|----|--------|-------|------|',
    '| T1 | x      | A     | a    |',
  ])
  const done = await ds(ws, ['regen-index', '.scratchpad'])
  assert.ok(
    done.stderr.includes('names no state column'),
    `a Tasks header naming no state column must be reported, not silently counted as zero; got: ${done.stderr}`,
  )
})

test('abandoned outranks a prose successor, and a real successor key renders its slug', async () => {
  const ws = root()
  put(ws, '_archive/2026-07-29-prose', [
    '`2026-07-29` · `done` · `P1/1`',
    '',
    '## §Z — Closeout',
    '',
    'abandoned: true',
    '',
    'reason: superseded',
    '',
    'summary: carried into the successor: the age-identity exemption',
  ])
  put(ws, '_archive/2026-07-28-handoff', ['`2026-07-28` · `done` · `P1/1`', '', '## §Z — Closeout', '', 'successor: next-wave', '', 'summary: phase 1 done'])
  await regen(ws)
  assert.equal(zOf(ws, 'prose'), 'abandoned', "abandoned: true outranks a prose 'successor:' in the same §Z")
  assert.equal(zOf(ws, 'handoff'), '→next-wave', 'a real successor key must still render →<slug>')
})

test('a formatter-joined key reads as unclosed, so the done header over it is drift', async () => {
  const ws = root()
  put(ws, '2026-08-02-joined', [
    '`2026-08-02` · `done` · `P1/1`',
    '',
    '## §Z — Closeout',
    '',
    '2026-08-02 10:00 — closed complete: true',
    '',
    'summary: joined by a formatter',
  ])
  await regen(ws)
  assert.equal(stateOf(ws, 'joined'), 'drift!', 'a formatter-joined key reads as unclosed, so the done header over it must surface as drift!')
})

test('a successor value outside the slug charset falls through', async () => {
  const ws = root()
  put(ws, '_archive/2026-07-02-badslug', ['`2026-07-02` · `done` · `P1/1`', '', '## §Z — Closeout', '', 'successor: auth_2'])
  await regen(ws)
  assert.equal(zOf(ws, 'badslug'), '—', 'a successor value outside the slug charset must fall through, not truncate to a slug that names another dossier')
})
