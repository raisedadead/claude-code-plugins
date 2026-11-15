import assert from 'node:assert/strict'
import { test } from 'vitest'
import { appendRow, checks, header, lint, planHash, replaceSection, section, setHeader } from '../engine/plan.ts'
import { PLAN } from './kit.ts'

test('a full plan lints clean', () => {
  assert.deepEqual(lint(PLAN), [])
})

test('lint requires the row header', () => {
  assert.ok(lint(PLAN.replace(/^row: .*\n/m, '')).includes('header: row'))
  assert.ok(!lint(PLAN).some((e) => e.startsWith('header:')))
})

test('lint names each gap in a plan', () => {
  const cases: [string, string, RegExp][] = [
    ['pr: feat(b): add the b module', 'pr: Add b.', /PR title: .*not a Conventional/],
    ['> "add b"', '', /Goal is empty/],
    ['- out: everything else', '- out: ', /"- out:" is empty/],
    ['1. Name it b? — yes · 2026-11-14', '1. Name it b? — ?', /open or out of shape/],
    ['confirmed: "go"', 'confirmed: ', /no "confirmed:"/],
    ['- b exists already → b-exists', '- b exists already → nothing-here', /names nothing-here/],
    ['| feat(c): add the c module | O2 | lib/** |', '| feat(c): add the c module | O9 | lib/** |', /O9, which is not a row/],
    ['| feat(c): add the c module | O2 | lib/** |', '| feat(b): add the b module and more | O2 | lib/** |', /is a prefix of/],
    ['| feat(c): add the c module | O2 | lib/** |', '| feat(c): add the c module and a very long tail here | O2 | lib/** |', /over 50/],
    ['| a-kept | `grep -q a src/a.ts` | exit 0 | yes | |', '| a-kept | grep -q a src/a.ts | 0 | yes | |', /check row is out of shape/],
    ['- O3 wait H Approve the PR', '- O3 wait H Approve the PR\n- O4 next A Stray work', /O4 is in no planned commit/],
  ]
  for (const [from, to, want] of cases) {
    assert.ok(PLAN.includes(from), from)
    assert.match(lint(PLAN.replace(from, to)).join('\n'), want)
  }
  assert.match(lint(PLAN.replace('## Notes', '## Other')).join('\n'), /## Notes is missing/)
})

test('the plan hash moves with the checked sections and not with rows or notes', () => {
  const hash = planHash(PLAN)
  assert.equal(planHash(appendRow(PLAN, '- O9 next H Read it')), hash)
  assert.equal(planHash(PLAN.replace('Keep it short.', 'Keep it shorter.')), hash)
  assert.notEqual(planHash(PLAN.replace('"add b"', '"add b and c"')), hash)
  assert.notEqual(planHash(PLAN.replace('exit 0 | yes', 'exit 1 | yes')), hash)
})

test('a check command keeps an escaped pipe', () => {
  const text = PLAN.replace('`grep -q a src/a.ts`', '`grep a src/a.ts \\| wc -l`')
  assert.equal(checks(text).checks.find((c) => c.name === 'a-kept')?.command, 'grep a src/a.ts | wc -l')
})

test('header and section edits touch only their part', () => {
  const text = setHeader(PLAN, 'checked', 'abc')
  assert.equal(header(text).checked, 'abc')
  assert.equal(header(setHeader(text, 'closed', 'done')).closed, 'done')
  assert.equal(section(text, 'Goal'), '> "add b"')
  const next = replaceSection(text, 'Goal', '> "other"')
  assert.equal(section(next, 'Goal'), '> "other"')
  assert.equal(section(next, 'Scope'), section(PLAN, 'Scope'))
})
