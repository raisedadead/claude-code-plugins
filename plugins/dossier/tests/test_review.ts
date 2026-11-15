import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { ds, file, planned, recordReview, repo, sh } from './kit.ts'

test('after a recorded review, the next pack shows only the new change', () => {
  const cwd = repo()
  sh(cwd, 'git switch -qc topic && echo one > src/one.ts && git add . && git commit -qm "feat: one"')
  const pack = ds(cwd, 'pack', 'review', '--base', 'main').out
  assert.match(file(pack), /\+one/)
  recordReview(cwd, 'PASS')
  sh(cwd, 'echo two > src/two.ts && git add . && git commit -qm "feat: two"')
  const next = file(ds(cwd, 'pack', 'review', '--base', 'main').out)
  assert.match(next, /\+two/)
  assert.doesNotMatch(next, /\+one/)
  assert.match(file(ds(cwd, 'pack', 'review', '--base', 'main', '--full').out), /\+one/)
  const findings = join(cwd, '.scratchpad/r.md')
  file(findings, 'VERDICT: CHANGES\n')
  assert.equal(ds(cwd, 'record', 'review', findings).code, 1)
})

test('help lists every command and an unknown command fails', () => {
  assert.match(ds('/', 'help').out, /ds record review <findings>/)
  assert.equal(ds('/', 'nope').code, 2)
  assert.match(ds('/', 'add', '--who').err, /--who needs a value/)
})

test('ds record review writes no review record; it sets state ship and logs', () => {
  const cwd = repo()
  const path = planned(cwd)
  sh(cwd, 'git switch -q demo || git switch -qc demo')
  const findings = join(dirname(path), 'review.md')
  file(findings, 'VERDICT: PASS\n')
  const done = ds(cwd, 'record', 'review', findings)
  assert.equal(done.code, 0, done.err)
  assert.match(done.out, /^REVIEW: PASS; state is ship/)
  assert.equal(existsSync(join(cwd, '.git/reviews.jsonl')), false)
  assert.match(file(path), /^state: ship$/m)
  assert.match(file(join(dirname(path), 'worklog.md')), /record review PASS [0-9a-f]{12} /)
})
