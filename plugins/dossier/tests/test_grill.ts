import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const FOOTER = ['FRONTIER: empty', 'CONFIRMED: 2026-10-09T10:00:00Z operator="go"']

function assertGrill(...entries: string[]) {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    mkdirSync(join(root, 'dossier', '.grill'), { recursive: true })
    writeFileSync(join(root, 'dossier', '.grill', '2026-10-09-wave.md'), `${entries.join('\n\n')}\n`)
    return spawnSync('sh', [DS, 'assert-grill', root, 'wave'], { encoding: 'utf8' })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a forked decision stays open while one of its children has no answer', () => {
  const done = assertGrill(
    'DECISION: 1. Close shape recommended=cli answer=forked → 1.1, 1.2',
    'DECISION: 1.1 Plan mode recommended=two calls answer="a" → (a)',
    'DECISION: 1.2 Commit owner recommended=the command',
    ...FOOTER,
  )
  assert.equal(done.status, 2, done.stderr)
  assert.match(done.stderr, /open decision\(s\): 1\.2/)
})

test('a forked decision with no children is still open', () => {
  const done = assertGrill('DECISION: 1. Close shape recommended=cli answer=forked', ...FOOTER)
  assert.equal(done.status, 2)
  assert.match(done.stderr, /open decision\(s\): 1 /)
})

test('a fork whose children all have answers passes, as does an external wait', () => {
  const done = assertGrill(
    'DECISION: 1. Close shape recommended=cli answer="discuss more" → forked 1.1',
    'DECISION: 1.1 Plan mode recommended=two calls answer="a" → (a)',
    'DECISION: 2. Budget recommended=ask answer=pending-external → q.md',
    ...FOOTER,
  )
  assert.equal(done.status, 0, done.stderr)
})

function grillAdd(root: string, entry: string) {
  return spawnSync('sh', [DS, 'grill-add', root, 'wave', entry], { encoding: 'utf8' })
}

test('grill-add writes each entry as its own paragraph and replaces a decision by id', () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    assert.equal(grillAdd(root, 'FACT: two contracts are stale cite=.dossier/').status, 0)
    assert.equal(grillAdd(root, 'DECISION: 1. Close shape recommended=cli').status, 0)
    const open = spawnSync('sh', [DS, 'assert-grill', root, 'wave'], { encoding: 'utf8' })
    assert.equal(open.status, 2)
    assert.match(open.stderr, /open decision\(s\): 1 /)
    assert.equal(grillAdd(root, 'DECISION: 1. Close shape recommended=cli answer="a" → (a)').status, 0)
    assert.equal(grillAdd(root, 'FRONTIER: empty').status, 0)
    assert.equal(grillAdd(root, 'CONFIRMED: 2026-10-09T10:00:00Z operator="go"').status, 0)
    const done = spawnSync('sh', [DS, 'assert-grill', root, 'wave'], { encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    const text = readFileSync(done.stdout.trim(), 'utf8')
    assert.equal(text.match(/^DECISION: 1\. /gm)?.length, 1)
    assert.match(text, /cite=\.dossier\/\n\nDECISION: 1\. Close shape recommended=cli answer="a" → \(a\)\n\nFRONTIER/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('grill-add refuses a fact with no cite, a decision with no recommendation and a CONSUMED line', () => {
  const root = mkdtempSync(join(tmpdir(), 'ds-grill-'))
  try {
    assert.equal(grillAdd(root, 'FACT: the sky is blue').status, 64)
    assert.equal(grillAdd(root, 'DECISION: 1. Shape').status, 64)
    assert.equal(grillAdd(root, 'CONSUMED: 2026-10-09-wave').status, 64)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
