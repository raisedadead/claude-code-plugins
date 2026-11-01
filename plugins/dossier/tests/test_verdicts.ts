import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isVerdictAgent, verdictLines } from '../engine/verdicts.ts'

test('only the plugin doubter and reviewer are verdict agents', () => {
  assert.equal(isVerdictAgent('whetstone:whetstone-doubter'), true)
  assert.equal(isVerdictAgent('dossier:dossier-reviewer'), true)
  assert.equal(isVerdictAgent('dossier-reviewer'), false)
  assert.equal(isVerdictAgent('other:whetstone-doubter'), false)
  assert.equal(isVerdictAgent('general-purpose'), false)
  assert.equal(isVerdictAgent(undefined), false)
})

test('the first verdict line is read through markdown emphasis', () => {
  const text = '**DOUBT:** FAILURES\n\n- a finding\n\n## SUBTRACT: 2 CUTS\n`REVIEW: PASS`\n'
  assert.deepEqual(verdictLines(text), ['DOUBT: FAILURES'])
})

test('a sentence that quotes a verdict is not read as one', () => {
  const text =
    '`REVIEW: CHANGES` iff any Critical finding.\nThe doubter said NO FAILURE FOUND last time.\nSUBTRACT: NOTHING TO CUT, probably\nSUBTRACT: 0 CUTS\n'
  assert.deepEqual(verdictLines(text), [])
})
