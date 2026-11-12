import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'

const VERIFY = join(import.meta.dirname, '..', 'bin', 'verify-clean')
const tmp = mkdtempSync(join(tmpdir(), 'whet-verify-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function tree(name: string, files: Record<string, string>): string {
  const dir = join(tmp, name)
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  return dir
}

const clean = tree('clean', { 'app.txt': 'resolved line\nanother\n' })
const dirty = tree('dirty', { 'app.txt': 'top\n<<<<<<< HEAD\nours\n=======\ntheirs\n>>>>>>> branch\n' })

function verify(...args: string[]) {
  return spawnSync(VERIFY, args, { encoding: 'utf8' })
}

test('a clean tree with a pass count at or above the baseline exits 0', () => {
  const done = verify(clean, '3', 'printf', '5')
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout, 'verify_clean: 0 markers, pass-count 5 >= 3\n')
})

test('a baseline of - skips the count check', () => {
  const done = verify(clean, '-', 'printf', '0')
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout, 'verify_clean: 0 markers\n')
})

test('a root alone checks markers only', () => {
  const done = verify(clean)
  assert.equal(done.status, 0, done.stderr)
  assert.equal(done.stdout, 'verify_clean: 0 markers\n')
})

test('conflict markers exit 1 and name the count', () => {
  const done = verify(dirty, '-', 'true')
  assert.equal(done.status, 1)
  assert.match(done.stderr, /^verify_clean: 2 conflict marker\(s\) remain under /)
  assert.match(done.stderr, /app\.txt:2:<<<<<<< HEAD/)
})

test('markers under .git do not count', () => {
  const repo = tree('gitdir', { 'a.txt': 'ok\n', '.git/MERGE_MSG': '<<<<<<< HEAD\n' })
  assert.equal(verify(repo).status, 0)
})

test('a pass-count regression exits 1', () => {
  const done = verify(clean, '5', 'printf', '3')
  assert.equal(done.status, 1)
  assert.equal(done.stderr, 'verify_clean: pass-count regressed: 3 < baseline 5\n')
})

test('a count command that prints no bare integer exits 1', () => {
  const done = verify(clean, '1', 'printf', 'five')
  assert.equal(done.status, 1)
  assert.equal(done.stderr, "verify_clean: count command must print a bare integer, got 'five'\n")
})

test('a failing count command passes its exit status through, silently', () => {
  const done = verify(clean, '128', 'sh', '-c', 'exit 7')
  assert.equal(done.status, 7)
  assert.equal(done.stderr, '')
})
