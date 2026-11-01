import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isVerdictAgent, verdictLines } from '../engine/verdicts.ts'

test('the plugin doubter and reviewer and the rig reviewer are the verdict agents', () => {
  assert.equal(isVerdictAgent('whetstone:whetstone-doubter'), true)
  assert.equal(isVerdictAgent('dossier:dossier-reviewer'), true)
  assert.equal(isVerdictAgent('reviewer'), true)
  assert.equal(isVerdictAgent('other:reviewer'), false)
  assert.equal(isVerdictAgent('dossier-reviewer'), false)
  assert.equal(isVerdictAgent('other:whetstone-doubter'), false)
  assert.equal(isVerdictAgent('general-purpose'), false)
  assert.equal(isVerdictAgent(undefined), false)
})

test('the first verdict line is read through markdown emphasis', () => {
  const text = '**DOUBT:** FAILURES\n\n- a finding\n\n## SUBTRACT: 2 CUTS\n`REVIEW: PASS`\n'
  assert.deepEqual(verdictLines(text), ['DOUBT: FAILURES'])
})

test('the rig reviewer verdict is read as its head, with the breakdown and any tail dropped', () => {
  assert.deepEqual(verdictLines('a.ts:3: major: x. y.\n\nREVIEW: 5 findings (1 major, 2 minor, 2 note)\n', 'reviewer'), ['REVIEW: 5 findings'])
  assert.deepEqual(verdictLines('nothing to report\n**REVIEW: clean**\n', 'reviewer'), ['REVIEW: clean'])
  assert.deepEqual(verdictLines('REVIEW: 1 finding (1 major (security))\n', 'reviewer'), ['REVIEW: 1 finding'])
  assert.deepEqual(verdictLines('REVIEW: 3 findings (3 major) — REVIEW: CHANGES\n', 'reviewer'), ['REVIEW: 3 findings'])
  assert.deepEqual(verdictLines('REVIEW: 9 findings; the parity gap stays\n', 'reviewer'), ['REVIEW: 9 findings'])
})

test('the rig reviewer verdict is its last verdict line, so a quoted one before it is skipped', () => {
  const text = 'a.ts:9: major: wrong grammar.\n```\nREVIEW: clean\n```\n> REVIEW: PASS\nREVIEW: 1 finding (1 major)\n'
  assert.deepEqual(verdictLines(text, 'reviewer'), ['REVIEW: 1 finding'])
})

test('a reviewer line that only resembles the verdict is not read as one', () => {
  assert.deepEqual(verdictLines('REVIEW: 0 findings\nREVIEW: clean, mostly\nREVIEW: some findings (2)\nREVIEW: PASS\n', 'reviewer'), [])
  assert.deepEqual(verdictLines('REVIEW: clean\n', 'dossier:dossier-reviewer'), [])
})

test('a sentence that quotes a verdict is not read as one', () => {
  const text =
    '`REVIEW: CHANGES` iff any Critical finding.\nThe doubter said NO FAILURE FOUND last time.\nSUBTRACT: NOTHING TO CUT, probably\nSUBTRACT: 0 CUTS\n'
  assert.deepEqual(verdictLines(text), [])
})
