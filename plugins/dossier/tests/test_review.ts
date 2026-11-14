import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, file, repo, sh } from './kit.ts'

test('a review outside a dossier is recorded against the tree, and the next pack shows only the new change', () => {
  const cwd = repo()
  sh(cwd, 'git switch -qc topic && echo one > src/one.ts && git add . && git commit -qm "feat: one"')
  const pack = ds(cwd, 'pack', 'review', '--base', 'main').out
  assert.match(file(pack), /\+one/)
  const findings = join(cwd, '.scratchpad/r.md')
  file(findings, 'VERDICT: PASS\n')
  assert.match(ds(cwd, 'record', 'review', findings, '--base', 'main').out, /REVIEW: PASS recorded/)
  const record = JSON.parse(readFileSync(join(cwd, '.git/reviews.jsonl'), 'utf8').trim())
  assert.equal(record.tree, sh(cwd, 'git rev-parse HEAD^{tree}'))
  assert.equal(record.branch, 'topic')
  assert.match(record.patch, /^[0-9a-f]{40}$/)
  sh(cwd, 'echo two > src/two.ts && git add . && git commit -qm "feat: two"')
  const next = file(ds(cwd, 'pack', 'review', '--base', 'main').out)
  assert.match(next, /\+two/)
  assert.doesNotMatch(next, /\+one/)
  assert.match(file(ds(cwd, 'pack', 'review', '--base', 'main', '--full').out), /\+one/)
  file(findings, 'VERDICT: CHANGES\n')
  assert.equal(ds(cwd, 'record', 'review', findings, '--base', 'main').code, 1)
})

test('help lists every command and an unknown command fails', () => {
  assert.match(ds('/', 'help').out, /ds record review <findings>/)
  assert.equal(ds('/', 'nope').code, 2)
  assert.match(ds('/', 'add', '--who').err, /--who needs a value/)
})
