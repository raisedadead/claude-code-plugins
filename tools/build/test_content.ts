import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { transformMarkdown } from '../../hosts/pi/content.ts'

const skills = new Map([
  ['dossier:build', 'dossier-build'],
  ['ds:build', 'dossier-build'],
  ['ds:status', 'dossier-status'],
  ['whetstone:tdd-cycle', 'whetstone-tdd-cycle'],
])
const context = { plugin: 'dossier' as const, path: 'skills/build/SKILL.md', skills }
const source = (plugin: string, skill: string) => readFileSync(resolve(import.meta.dirname, `../../plugins/${plugin}/skills/${skill}/SKILL.md`), 'utf8')

test('frontmatter stays byte-identical while host invocations and shell resource roots change', () => {
  const header = '---\nname: build\ndescription: Use ds:build.\n---\n'
  const result = transformMarkdown(header + '# Build\nRun `dossier:build` then `whetstone:tdd-cycle`.\n"${CLAUDE_PLUGIN_ROOT}"/cli/ds status\n', context)
  expect(result.slice(0, header.length)).toBe(header)
  expect(result).toContain('/skill:dossier-build')
  expect(result).toContain('/skill:whetstone-tdd-cycle')
  expect(result).toContain('"$DOSSIER_PLUGIN_ROOT"/cli/ds status')
  expect(result).not.toContain('${CLAUDE_PLUGIN_ROOT}')
})

test('ledger event grammar, ordinary JavaScript interpolation and shell defaults remain data', () => {
  const text = '# Protocol\n```\n2026-11-04 01:00 ds:build T1 START\n```\n`${id}`; `${TMPDIR:-/tmp}`; `ds:build T1 red=1-failed`\n'
  const result = transformMarkdown(text, { ...context, path: 'FORMAT.md' })
  expect(result).toContain('2026-11-04 01:00 ds:build T1 START')
  expect(result).toContain('`ds:build T1 red=1-failed`')
  expect(result).toContain('`${id}`; `${TMPDIR:-/tmp}`')
})

test('build uses native fresh delegation and a supported driver, not Claude Goal or Task tools', () => {
  const result = transformMarkdown(source('dossier', 'build'), context)
  expect(result).not.toMatch(/ProposeGoal|SendMessage|TaskUpdate|native `\/goal`/)
  expect(result).toContain('dossier_delegate')
  expect(result).toContain('dossier_auto')
  expect(result).toContain('route=pi')
  expect(result).toContain('ds:build <T-id> red=<n>-failed')
})

test('optional absent sibling invocations still map without manufacturing a dependency', () => {
  const result = transformMarkdown('Invoke `whetstone:grill` only when installed.', context)
  expect(result).toContain('/skill:whetstone-grill')
  expect(result).toContain('only when installed')
})

test('status uses the native ledger view and explicit transcript access', () => {
  const result = transformMarkdown(source('dossier', 'status'), { ...context, path: 'skills/status/SKILL.md' })
  expect(result).not.toMatch(/TaskList|TaskCreate|TaskUpdate|~\/\.claude\/projects|\/goal clear/)
  expect(result).toContain('/dossier-tasks')
})

test('research uses native validation rather than an ambient Claude Workflow', () => {
  const result = transformMarkdown(source('whetstone', 'research-report'), { plugin: 'whetstone', path: 'skills/research-report/SKILL.md', skills })
  expect(result).toContain('whetstone_verify_claims')
  expect(result).not.toContain('`whetstone:verify-claims` workflow')
  expect(result).not.toContain('Claude routed it')
})

test('subtraction does not read Claude settings or invent provider model aliases', () => {
  const result = transformMarkdown(source('whetstone', 'doubt-pass'), { plugin: 'whetstone', path: 'skills/doubt-pass/SKILL.md', skills })
  expect(result).not.toMatch(/\.claude\/settings|advisorModel|session model's family/)
  expect(result).toContain('provider/model')
})

test('named agents are not turned into nonexistent skills, and availability checks use native tools', () => {
  const result = transformMarkdown(source('dossier', 'build'), context)
  expect(result).not.toContain('/skill:whetstone-whetstone-doubter')
  expect(result).not.toContain('session agent list')
  expect(result).toContain('whetstone_delegate')
})

test('composed executables resolve an installed sibling file instead of searching PATH', () => {
  const result = transformMarkdown(source('dossier', 'build'), context)
  expect(result).not.toMatch(/on `PATH`|`run-slice red|`lint-skill <path>/)
  expect(result).toContain('$DOSSIER_PLUGIN_ROOT/../whetstone/bin/run-slice')
  expect(result).toContain('$DOSSIER_PLUGIN_ROOT/../whetstone/bin/tiger-check')
})

test('a stale dossier directory alone does not route a standalone whetstone install away', () => {
  const result = transformMarkdown(source('whetstone', 'grill'), { plugin: 'whetstone', path: 'skills/grill/SKILL.md', skills })
  expect(result).toContain('installed skills include `dossier-grill`')
})

test('renderer uses its cache fallback rather than a nonexistent Pi substitution variable', () => {
  const result = transformMarkdown(source('whetstone', 'html-report'), { plugin: 'whetstone', path: 'skills/html-report/SKILL.md', skills })
  expect(result).not.toMatch(/CLAUDE_PLUGIN_(DATA|ROOT)/)
  expect(result).toContain('"$WHETSTONE_PLUGIN_ROOT"/bin/html-report')
})
