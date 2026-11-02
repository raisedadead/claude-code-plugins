import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const SLUG = '2026-06-01-closure'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function workspaceWithCloseout(zbody: string): string {
  const { dir, clean } = tempRoot('dossier-closure-')
  cleanups.push(clean)
  mkdirSync(join(dir, '.scratchpad', 'dossier', SLUG), { recursive: true })
  mkdirSync(join(dir, '.scratchpad', 'dossier', '_archive'), { recursive: true })
  writeFileSync(
    join(dir, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'),
    `\`2026-06-01\` · \`live\` · \`P1/1\`\n\n## §T — Task ledger\n\n| T1 | P1 | x | thing | [a1] | — |\n\n## §S — Rolling status log\n\n2026-06-01 10:00 ds:close — START successor=— complete=true abandon=false\n\n## §Z — Closeout\n\n${zbody}\n`,
  )
  return dir
}

async function regenSeesClosed(ws: string): Promise<boolean> {
  await ds(ws, ['regen-index', '.scratchpad'])
  const index = join(ws, '.scratchpad', 'INDEX.md')
  return existsSync(index) && readFileSync(index, 'utf8').includes('drift!')
}

async function reconcileSeesClosed(ws: string): Promise<boolean> {
  await ds(ws, ['reconcile', '.scratchpad'])
  return existsSync(join(ws, '.scratchpad', 'dossier', '_archive', SLUG))
}

const CASES: readonly (readonly [string, boolean, string])[] = [
  ['complete: true', true, 'bare machine key'],
  ['complete: true.', true, 'machine key with trailing punctuation'],
  ['successor: 2026-07-01-next', true, 'successor key'],
  ['abandoned: true', true, 'abandoned key'],
  ['_(empty — written by ds:close)_', false, 'no machine key at all'],
  ['we completed: true things', false, 'prose that merely contains the words'],
  ['successor: The Big Rewrite', false, 'a successor value outside the slug charset'],
  ['carried into the successor: the age-identity exemption', false, 'a lowercase prose word mid-sentence'],
  ['2026-06-01 10:00 — closed complete: true', false, 'a formatter-joined key that no longer opens its line'],
  ['- complete: true', false, 'a key inside a list item — hand-edit shape, fails open'],
  ['successor: auth_2', false, 'a successor value that does not end the token'],
]

for (const [zbody, want, label] of CASES) {
  test(`closure predicates agree: ${label}`, async () => {
    const fromRegen = await regenSeesClosed(workspaceWithCloseout(zbody))
    const fromRecon = await reconcileSeesClosed(workspaceWithCloseout(zbody))
    assert.equal(fromRegen, fromRecon, `${label}: closure predicates disagree — regen=${fromRegen} reconcile=${fromRecon}`)
    assert.equal(fromRegen, want, `${label}: expected closed=${want}, both reported ${fromRegen}`)
  })
}
