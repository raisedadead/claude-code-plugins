import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const REGISTRY = [
  { id: 'V1', pattern: 'eval\\(', message: 'no eval', paths: ['src/*.py'] },
  { id: 'V9', pattern: '(?x) a b' },
]

function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-cli-'))
  try {
    mkdirSync(join(root, '.scratchpad', 'dossier'), { recursive: true })
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify(REGISTRY))
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function check(root: string, filePath: string, text: string) {
  const input = JSON.stringify({ file_path: filePath, chunks: [text] })
  return spawnSync('sh', [DS, 'invariant-check', root], { input, encoding: 'utf8' })
}

test('invariant-check exits 1 with the reason on a registered pattern', () => {
  withRoot((root) => {
    const done = check(root, 'src/app.py', 'x = eval(y)')
    assert.equal(done.status, 1, done.stderr)
    assert.match(done.stdout, /violates §V V1/)
  })
})

test('invariant-check exits 0 off the pattern and off the scope, and names a skipped pattern', () => {
  withRoot((root) => {
    const clean = check(root, 'src/app.py', 'x = safe(y)')
    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /§V V9 not checked/)
    assert.equal(check(root, 'lib/app.py', 'eval(').status, 0)
  })
})

test('invariant-check exits 0 on a malformed registry or payload', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), 'not json')
    assert.equal(check(root, 'src/app.py', 'eval(').status, 0)
  })
  withRoot((root) => {
    const done = spawnSync('sh', [DS, 'invariant-check', root], { input: 'garbage', encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
  })
})

test('ds exits 64 on an unknown verb', () => {
  assert.equal(spawnSync('sh', [DS, 'nope'], { encoding: 'utf8' }).status, 64)
})

test('ds exits 69 when node is not on PATH', () => {
  const done = spawnSync('/bin/sh', [DS, 'invariant-check'], { encoding: 'utf8', env: { PATH: '/nonexistent' } })
  assert.equal(done.status, 69)
  assert.match(done.stderr, /node 22\.18\+ required/)
})
