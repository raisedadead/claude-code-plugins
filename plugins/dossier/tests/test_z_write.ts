import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const DOSSIER =
  '`2026-06-01` · `live` · `P1/1`\n\n## §S — Rolling status log\n\n2026-06-01 10:00 ds:new — created\n\n## §Z — Closeout\n\n_(empty — written by ds:close)_\n'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function root(): string {
  const { dir, clean } = tempRoot('dossier-zwrite-')
  cleanups.push(clean)
  return dir
}

function mkdoss(base: string, name: string): string {
  const dir = join(base, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), DOSSIER)
  return dir
}

function body(dir: string): string {
  return readFileSync(join(dir, 'DOSSIER.md'), 'utf8')
}

function hasLine(text: string, line: string): boolean {
  return text.split('\n').includes(line)
}

test('the complete kind writes complete, summary and cites, keeps the status log, and leaves no temp file', async () => {
  const base = root()
  const d1 = mkdoss(base, 'complete')
  const done = await ds(base, ['z-write', d1, 'complete', '—', 'P1 shipped', '[a1], [b2]'])
  assert.equal(done.code, 0, done.stderr)
  const text = body(d1)
  assert.ok(hasLine(text, 'complete: true'), 'complete kind must write complete: true')
  assert.ok(hasLine(text, 'summary: P1 shipped'), 'summary not written')
  assert.ok(hasLine(text, 'key cites: [a1], [b2]'), 'cites not written')
  assert.ok(text.includes('ds:new — created'), 'content before §Z (the §S log) must be preserved')
  assert.deepEqual(
    readdirSync(d1, { recursive: true }).filter((name) => String(name).split('/').pop()?.startsWith('DOSSIER.md.')),
    [],
    'z-write left a temp orphan',
  )
})

test('the successor kind writes the successor slug', async () => {
  const base = root()
  const d2 = mkdoss(base, 'successor')
  const done = await ds(base, ['z-write', d2, 'successor', 'auth-2', 'phase 1 done', '[c3]'])
  assert.equal(done.code, 0, done.stderr)
  assert.ok(hasLine(body(d2), 'successor: auth-2'), 'successor kind must write successor: <slug>')
})

test('the abandoned kind writes abandoned and the reason', async () => {
  const base = root()
  const d3 = mkdoss(base, 'abandoned')
  const done = await ds(base, ['z-write', d3, 'abandoned', 'superseded by valkey', 'P1 only', '—'])
  assert.equal(done.code, 0, done.stderr)
  const text = body(d3)
  assert.ok(hasLine(text, 'abandoned: true'), 'abandoned kind must write abandoned: true')
  assert.ok(hasLine(text, 'reason: superseded by valkey'), 'abandoned must write reason')
})

test('the section fields are blank-line separated', async () => {
  const base = root()
  const d1 = mkdoss(base, 'complete')
  const done = await ds(base, ['z-write', d1, 'complete', '—', 'P1 shipped', '[a1], [b2]'])
  assert.equal(done.code, 0, done.stderr)
  const lines = body(d1).split('\n')
  const bad = lines.some((line, index) => line === 'complete: true' && (index === 0 ? '' : lines[index - 1]) !== '')
  assert.ok(!bad, '§Z fields must be blank-line separated (formatter-resistant)')
})

test('a live-located dossier with a written §Z regenerates as drift', async () => {
  const base = root()
  const d1 = mkdoss(base, 'complete')
  const written = await ds(base, ['z-write', d1, 'complete', '—', 'P1 shipped', '[a1], [b2]'])
  assert.equal(written.code, 0, written.stderr)
  const sp = join(base, 'sp', '.scratchpad')
  mkdirSync(join(sp, 'dossier', '2026-06-01-c'), { recursive: true })
  cpSync(join(d1, 'DOSSIER.md'), join(sp, 'dossier', '2026-06-01-c', 'DOSSIER.md'))
  const done = await ds(join(base, 'sp'), ['regen-index', '.scratchpad'])
  assert.equal(done.code, 0, done.stderr)
  assert.ok(readFileSync(join(sp, 'INDEX.md'), 'utf8').includes('drift!'), 'z_closed must be detected from ds z-write output')
})

test('an invalid kind and a successor without a slug are refused', async () => {
  const base = root()
  const d1 = mkdoss(base, 'complete')
  const d2 = mkdoss(base, 'successor')
  assert.notEqual((await ds(base, ['z-write', d1, 'bogus', 'x'])).code, 0, 'invalid kind must error')
  assert.notEqual((await ds(base, ['z-write', d2, 'successor', ''])).code, 0, 'successor without slug must error')
})

test('a summary line that opens with a closure key is refused and leaves §Z untouched', async () => {
  const base = root()
  const d4 = mkdoss(base, 'prose-key')
  const done = await ds(base, ['z-write', d4, 'abandoned', 'superseded', 'P1 shipped\nsuccessor: auth-2'])
  assert.notEqual(done.code, 0, 'a summary line that opens with a §Z closure key must be refused, not written')
  assert.ok(body(d4).includes('_(empty — written by ds:close)_'), 'a refused close must leave §Z untouched')
})

test('a mid-sentence successor in prose still closes', async () => {
  const base = root()
  const d5 = mkdoss(base, 'prose-ok')
  const done = await ds(base, ['z-write', d5, 'abandoned', 'valkey took over', 'carried into the successor: the age-identity exemption', '—'])
  assert.equal(done.code, 0, done.stderr)
  assert.ok(hasLine(body(d5), 'abandoned: true'), "a mid-sentence 'successor:' in prose must still close")
})

test('a successor value the readers reject is refused, and a date-prefixed slug is valid', async () => {
  const base = root()
  const d6 = mkdoss(base, 'badslug')
  const bad = await ds(base, ['z-write', d6, 'successor', 'The Big Rewrite', 'phase 1 done', '[c3]'])
  assert.notEqual(bad.code, 0, 'a successor value the readers reject must not be written as a close')
  const newline = await ds(base, ['z-write', d6, 'successor', 'auth-2\nabandoned: true', 'phase 1 done', '[c3]'])
  assert.notEqual(newline.code, 0, 'a newline in the successor value must be refused — its second line anchors as a key')
  const good = await ds(base, ['z-write', d6, 'successor', '2026-07-01-next-wave', 'phase 1 done', '[c3]'])
  assert.equal(good.code, 0, good.stderr)
  assert.ok(hasLine(body(d6), 'successor: 2026-07-01-next-wave'), 'a date-prefixed slug is a valid successor')
})

test('a summary opening with a key still writes, since the rendered line carries a field prefix', async () => {
  const base = root()
  const d7 = mkdoss(base, 'summary-key')
  const done = await ds(base, ['z-write', d7, 'abandoned', 'dropped', 'complete: true never came back from CI', '[a1]'])
  assert.equal(done.code, 0, done.stderr)
  assert.ok(hasLine(body(d7), 'summary: complete: true never came back from CI'))
})
