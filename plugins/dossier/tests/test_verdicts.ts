import assert from 'node:assert/strict'
import { test } from 'vitest'
import { findingLines, isVerdictAgent, structuredFindings, verdictLines } from '../engine/verdicts.ts'

const DOUBTER = 'whetstone:whetstone-doubter'
const REVIEWER = 'whetstone:whetstone-reviewer'

test('the plugin doubter and reviewers and the rig reviewer are the verdict agents', () => {
  assert.equal(isVerdictAgent(REVIEWER), true)
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

test('the plugin reviewer verdict is its last REVIEW line', () => {
  const text = 'run.ts:3: blocker: shell injection. Use execFileSync.\nREVIEW: 1 finding (1 blocker)\n'
  assert.deepEqual(verdictLines(text, REVIEWER), ['REVIEW: 1 finding'])
  assert.deepEqual(verdictLines('The rename keeps behaviour.\n\nREVIEW: clean\n', REVIEWER), ['REVIEW: clean'])
})

test('doubter findings are the bullets after the verdict, up to Caveats', () => {
  const text = 'preamble\n- not a finding\nDOUBT: FAILURES\n\n- a → b\n- c → d\n\n## Caveats\n- e\n'
  assert.deepEqual(findingLines(text, DOUBTER), ['a → b', 'c → d'])
})

test('dossier-reviewer findings are the bullets under Spec and Standards', () => {
  const text = 'REVIEW: CHANGES\n\n## Spec\n\n- Critical: x. y.\n- Warn: z.\n\n## Standards\n\n- Nit: w.\n\n## Caveats\n\n- none\n'
  assert.deepEqual(findingLines(text, 'dossier:dossier-reviewer'), ['Critical: x. y.', 'Warn: z.', 'Nit: w.'])
})

test('plugin reviewer findings are its path:line lines, not its prose', () => {
  const text =
    'Two defects.\nrun.ts:3: blocker: shell injection. Use execFileSync.\nsrc/a.ts:10: note: old gap.\n- a bullet\nREVIEW: 2 findings (1 blocker, 1 note)\n'
  assert.deepEqual(findingLines(text, REVIEWER), ['run.ts:3: blocker: shell injection. Use execFileSync.', 'src/a.ts:10: note: old gap.'])
})

test('the rig reviewer, another agent and a reply with no verdict log no findings', () => {
  assert.deepEqual(findingLines('a.ts:3: major: x. y.\nREVIEW: 1 finding (1 major)\n', 'reviewer'), [])
  assert.deepEqual(findingLines('DOUBT: FAILURES\n- a → b\n', 'general-purpose'), [])
  assert.deepEqual(findingLines('- a → b\n', DOUBTER), [])
})

test('a row keeps at most 20 findings of at most 200 characters', () => {
  const bullets = Array.from({ length: 25 }, (_, at) => `- finding ${at}`).join('\n')
  const found = findingLines(`DOUBT: FAILURES\n${bullets}\n- ${'x'.repeat(300)}\n`, DOUBTER)
  assert.equal(found.length, 20)
  assert.equal(findingLines(`DOUBT: FAILURES\n- ${'x'.repeat(300)}\n`, DOUBTER)[0]?.length, 200)
})

test('plugin reviewer structured findings become path:line lines; other agents log none', () => {
  const output = { findings: [{ file: 'a.ts', line: 3, severity: 'major', problem: 'x', fix: 'y' }, { file: 'b.ts' }] }
  assert.deepEqual(structuredFindings(output, REVIEWER), ['a.ts:3: major: x'])
  assert.deepEqual(structuredFindings(output, 'reviewer'), [])
  assert.deepEqual(structuredFindings({ real: true }, REVIEWER), [])
})
