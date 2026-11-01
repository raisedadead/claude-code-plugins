import assert from 'node:assert/strict'
import { test } from 'vitest'
import { isVerdictAgent, verdictLines } from '../engine/verdicts.ts'

test('the doubter and the reviewer are verdict agents, with or without a plugin prefix', () => {
  assert.equal(isVerdictAgent('whetstone:whetstone-doubter'), true)
  assert.equal(isVerdictAgent('dossier-reviewer'), true)
  assert.equal(isVerdictAgent('general-purpose'), false)
  assert.equal(isVerdictAgent('reviewer'), false)
  assert.equal(isVerdictAgent(undefined), false)
})

test('a verdict line is read through markdown emphasis, once per line', () => {
  const text = '**DOUBT:** FAILURES\n\n- a finding\n\n## SUBTRACT: 2 CUTS\n`REVIEW: PASS`\nDOUBT: FAILURES\n'
  assert.deepEqual(verdictLines(text), ['DOUBT: FAILURES', 'SUBTRACT: 2 CUTS', 'REVIEW: PASS'])
})

test('a sentence that quotes a verdict is not read as one', () => {
  const text = '`REVIEW: CHANGES` iff any Critical finding.\nThe doubter said NO FAILURE FOUND last time.\nSUBTRACT: NOTHING TO CUT, probably\n'
  assert.deepEqual(verdictLines(text), [])
})
