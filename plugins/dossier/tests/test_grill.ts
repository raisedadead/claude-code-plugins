import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds } from './inproc.ts'

const FOOTER = ['FRONTIER: empty', 'CONFIRMED: 2026-10-09T10:00:00Z operator="go"']

async function assertGrill(...entries: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    mkdirSync(join(root, 'dossier', '.grill'), { recursive: true })
    writeFileSync(join(root, 'dossier', '.grill', '2026-10-09-wave.md'), `${entries.join('\n\n')}\n`)
    return await ds(process.cwd(), ['assert-grill', root, 'wave'])
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a forked decision stays open while one of its children has no answer', async () => {
  const done = await assertGrill(
    'DECISION: 1. Close shape recommended=cli answer=forked → 1.1, 1.2',
    'DECISION: 1.1 Plan mode recommended=two calls answer="a" → (a)',
    'DECISION: 1.2 Commit owner recommended=the command',
    ...FOOTER,
  )
  assert.equal(done.code, 2, done.stderr)
  assert.match(done.stderr, /open decision\(s\): 1\.2/)
})

test('a forked decision with no children is still open', async () => {
  const done = await assertGrill('DECISION: 1. Close shape recommended=cli answer=forked', ...FOOTER)
  assert.equal(done.code, 2)
  assert.match(done.stderr, /open decision\(s\): 1 /)
})

test('a fork whose children all have answers passes, as does an external wait', async () => {
  const done = await assertGrill(
    'DECISION: 1. Close shape recommended=cli answer="discuss more" → forked 1.1',
    'DECISION: 1.1 Plan mode recommended=two calls answer="a" → (a)',
    'DECISION: 2. Budget recommended=ask answer=pending-external → q.md',
    ...FOOTER,
  )
  assert.equal(done.code, 0, done.stderr)
})

function grillAdd(root: string, entry: string) {
  return ds(process.cwd(), ['grill-add', root, 'wave', entry])
}

test('grill-add writes each entry as its own paragraph and replaces a decision by id', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    assert.equal((await grillAdd(root, 'FACT: two contracts are stale cite=.dossier/')).code, 0)
    assert.equal((await grillAdd(root, 'DECISION: 1. Close shape recommended=cli probe=cli/ds:12')).code, 0)
    const open = await ds(process.cwd(), ['assert-grill', root, 'wave'])
    assert.equal(open.code, 2)
    assert.match(open.stderr, /open decision\(s\): 1 /)
    assert.equal((await grillAdd(root, 'DECISION: 1. Close shape recommended=cli probe=cli/ds:12 answer="a" → (a)')).code, 0)
    assert.equal((await grillAdd(root, 'FRONTIER: empty')).code, 0)
    assert.equal((await grillAdd(root, 'CONFIRMED: 2026-10-09T10:00:00Z operator="go"')).code, 0)
    const done = await ds(process.cwd(), ['assert-grill', root, 'wave'])
    assert.equal(done.code, 0, done.stderr)
    const text = readFileSync(done.stdout.trim(), 'utf8')
    assert.equal(text.match(/^DECISION: 1\. /gm)?.length, 1)
    assert.match(text, /cite=\.dossier\/\n\nDECISION: 1\. Close shape recommended=cli probe=cli\/ds:12 answer="a" → \(a\)\n\nFRONTIER/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('grill-add takes a taste probe and reads a backticked probe that names answer= as unanswered', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    assert.equal((await grillAdd(root, 'DECISION: 1. Shape recommended=cli probe=—')).code, 0)
    assert.equal((await grillAdd(root, "DECISION: 2. Move recommended=keep both probe=`rg 'answer=(' engine/grill.ts:9`")).code, 0)
    assert.equal((await grillAdd(root, 'DECISION: 3. Name recommended=short probe=— answer="3: a" → (a)')).code, 0)
    const open = await ds(process.cwd(), ['assert-grill', root, 'wave'])
    assert.equal(open.code, 2)
    assert.match(open.stderr, /open decision\(s\): 1, 2 /)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('grill-add refuses a fact with no cite, a decision with no recommendation or probe and a CONSUMED line', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    assert.equal((await grillAdd(root, 'FACT: the sky is blue')).code, 64)
    assert.equal((await grillAdd(root, 'DECISION: 1. Shape')).code, 64)
    const unprobed = await grillAdd(root, 'DECISION: 1. Shape recommended=cli')
    assert.equal(unprobed.code, 64)
    assert.match(unprobed.stderr, /probe=/)
    assert.equal((await grillAdd(root, 'DECISION: 1. Topic about probe=x recommended=cli')).code, 64)
    assert.equal((await grillAdd(root, "DECISION: 1. Move recommended=keep probe=rg 'answer=(' engine/grill.ts")).code, 64)
    assert.equal((await grillAdd(root, 'CONSUMED: 2026-10-09-wave')).code, 64)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
