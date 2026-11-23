import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { ds, file, planned, recordReview, repo, sh } from './kit.ts'

test('after a recorded review, the next pack shows only the new change', () => {
  const cwd = repo()
  const empty = ds(cwd, 'pack', 'review', '--base', 'main')
  assert.equal(empty.code, 1)
  assert.match(empty.err, /main has no commit past main\. Run ds pack review in the worktree of the branch/)
  sh(cwd, 'git switch -qc topic && echo one > src/one.ts && git add . && git commit -qm "feat: one"')
  const pack = ds(cwd, 'pack', 'review', '--base', 'main').out
  assert.match(file(pack), /\+one/)
  const RIG_REVIEWED = /^[ \t*_>`-]*REVIEWED:[ \t]*(\/.*?)[ \t]+(\S+)[ \t]+(\S+?)\.\.(\S+?)[ \t`*_]*$/gm
  const [line = []] = [...file(pack).matchAll(RIG_REVIEWED)]
  assert.deepEqual(line.slice(1), [sh(cwd, 'git rev-parse --show-toplevel'), 'topic', 'main', sh(cwd, 'git rev-parse HEAD')])
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

test('a pack for another review agent starts from the last record of that agent', () => {
  const cwd = repo()
  sh(cwd, 'git switch -qc topic && echo one > src/one.ts && git add . && git commit -qm "feat: one"')
  recordReview(cwd, 'PASS', { agent: 'reviewer' })
  assert.doesNotMatch(file(ds(cwd, 'pack', 'review', '--base', 'main').out), /\+one/)
  assert.match(file(ds(cwd, 'pack', 'review', '--base', 'main', '--agent', 'security-reviewer').out), /\+one/)
  recordReview(cwd, 'PASS', { agent: 'security-reviewer' })
  sh(cwd, 'echo two > src/two.ts && git add . && git commit -qm "feat: two"')
  const next = file(ds(cwd, 'pack', 'review', '--base', 'main', '--agent', 'security-reviewer').out)
  assert.match(next, /\+two/)
  assert.doesNotMatch(next, /\+one/)
  recordReview(cwd, 'PASS', { agent: 'security-reviewer' })
  assert.match(file(ds(cwd, 'pack', 'review', '--base', 'main').out), /\+two/, 'the reviewer has not seen it')
})

test('a record from a whetstone helper counts for its role, and one from another plugin does not', () => {
  const cwd = repo()
  sh(cwd, 'git switch -qc topic && echo one > src/one.ts && git add . && git commit -qm "feat: one"')
  recordReview(cwd, 'PASS', { agent: 'other:reviewer' })
  assert.match(file(ds(cwd, 'pack', 'review', '--base', 'main').out), /\+one/)
  recordReview(cwd, 'PASS', { agent: 'whetstone:reviewer' })
  assert.doesNotMatch(file(ds(cwd, 'pack', 'review', '--base', 'main').out), /\+one/)
  recordReview(cwd, 'PASS', { agent: 'whetstone:security-reviewer' })
  assert.doesNotMatch(file(ds(cwd, 'pack', 'review', '--base', 'main', '--agent', 'security-reviewer').out), /\+one/)
  assert.doesNotMatch(file(ds(cwd, 'pack', 'review', '--base', 'main', '--agent', 'whetstone:security-reviewer').out), /\+one/)
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
