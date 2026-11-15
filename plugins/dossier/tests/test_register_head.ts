import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, file, repo } from './kit.ts'

test('a new register tells the hand rule for an ID and the row: header', () => {
  const cwd = repo()
  ds(cwd, 'add', 'First', '--register')
  const text = file(join(cwd, '.scratchpad/OPEN-WORK.md'))
  assert.match(text, /one more than the highest O number in this file and in every DOSSIER\.md under `\.scratchpad\/dossier\/`, live or archived/)
  assert.match(text, /the line whose ID the `row:` field of its DOSSIER\.md header names/)
  assert.match(text, /## Rows\n\n- O1 next A First\n/)
  assert.doesNotMatch(text.split('## Rows')[0], /O\d/)
})
