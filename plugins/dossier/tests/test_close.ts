import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { cleanTemplates, close, contract, live, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('--plan names the open agent rows, refuses with exit 1 and writes nothing', async () => {
  await within(
    async (root) => {
      const before = live(root)
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 1, done.stdout + done.stderr)
      assert.match(done.stdout, /✗ T2 open/)
      assert.equal(live(root), before)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'A'],
    ],
  )
})

test('--plan on a finished wave reports ready with exit 0 and writes nothing', async () => {
  await within(
    async (root) => {
      const before = live(root)
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /✓ converge 1\/1/)
      assert.match(done.stdout, /^ready$/m)
      assert.match(done.stdout, /⚠ no CHANGELOG\.md changed since the contract commit/)
      assert.equal(live(root), before)
    },
    [['T1', 'x', 'A']],
    { changelog: true },
  )
})

function grill(root: string): void {
  mkdirSync(join(root, '.scratchpad', 'dossier', '.grill'), { recursive: true })
  const text = [
    'DECISION: 1. Wave shape recommended=one wave probe=a.md:1 answer="a" → (a)',
    'DECISION: 2. Model choice recommended=session probe=— answer="a" → (a)',
    `CONSUMED: ${SLUG}`,
    '',
  ].join('\n')
  writeFileSync(join(root, '.scratchpad', 'dossier', '.grill', '2026-10-08-wave.md'), text)
}

test('--plan lists the grill decisions as a lessons advisory where RESEARCH.md exists', async () => {
  await within(
    async (root) => {
      grill(root)
      writeFileSync(join(root, 'RESEARCH.md'), '# RESEARCH\n')
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /^ {2}⚠ lessons: 2 grill decisions — ask which become a RESEARCH\.md §D row: 1\. Wave shape; 2\. Model choice$/m)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on lessons with no RESEARCH.md', async () => {
  await within(
    async (root) => {
      grill(root)
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /lessons/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan says the changelog check did not run when the contract is untracked', async () => {
  await within(
    async (root) => {
      rmSync(join(root, '.dossier'), { recursive: true, force: true })
      writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'CONTRACT.md'), contract())
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /⚠ no tracked contract — the CHANGELOG\.md check did not run/)
    },
    [['T1', 'x', 'A']],
    { changelog: true },
  )
})

test('--plan stays silent on the changelog advisory when no repo tracks a CHANGELOG.md', async () => {
  await within(
    async (root) => {
      rmSync(join(root, '.dossier'), { recursive: true, force: true })
      writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'CONTRACT.md'), contract())
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})
