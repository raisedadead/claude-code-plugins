import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { archived, cleanTemplates, close, DS, lastSubject, must, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('a run writes §Z, archives the wave, commits the contract move alone and logs DONE', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'unrelated.txt'), 'x')
      await must('git', ['-C', root, 'add', 'unrelated.txt'])
      const done = await close(root, '--complete', '--summary', 'shipped it')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      const text = archived(root)
      assert.match(text, /^`2026-10-09` · `done`$/m)
      assert.match(text, /^complete: true$/m)
      assert.match(text, /^summary: shipped it$/m)
      const sha = (await must('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).trim()
      for (const step of ['START mode=complete', '§Z=written', 'archived', `contract=${sha}`, 'DONE']) {
        assert.ok(text.includes(`ds:close — ${step}`), step)
      }
      assert.ok(!existsSync(join(root, '.scratchpad', 'dossier', SLUG)))
      assert.ok(!existsSync(join(root, '.scratchpad', 'dossier', '_archive', SLUG, '.ds-lock')))
      assert.ok(existsSync(join(root, '.dossier', '_archive', `${SLUG}.md`)))
      assert.equal(await lastSubject(root), `chore(dossier): archive wave contract ${SLUG}`)
      const staged = await must('git', ['-C', root, 'diff', '--cached', '--name-only'])
      assert.equal(staged.trim(), 'unrelated.txt')
      assert.match(readFileSync(join(root, '.scratchpad', 'INDEX.md'), 'utf8'), /\| wave \| done \|/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--carry takes an operator row and a delayed row into an after line, and refuses a plain agent row', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--plan', '--carry', 'T2,T3,T4')
      assert.equal(refused.status, 1)
      assert.match(refused.stdout, /✗ T4 cannot carry/)
      await must('sh', [DS, 'row-flip', join(root, '.scratchpad', 'dossier', SLUG), 'T4', 'x', 'def5678'], root)
      const done = await close(root, '--complete', '--carry', 'T2,T3', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /^after: T2 task T2 \(H\); T3 task T3 \(T1\+7d\)$/m)
      assert.match(archived(root), /ds:close — later=2026-10-09-wave\/T2,2026-10-09-wave\/T3$/m)
      const list = readFileSync(join(root, '.scratchpad', 'dossier', 'LATER.md'), 'utf8')
      assert.match(list, /^- 2026-10-09-wave\/T2 · task T2 · H$/m)
      assert.match(list, /^- 2026-10-09-wave\/T3 · task T3 · T1\+7d$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
      ['T3', '.', 'A', 'T1+7d'],
      ['T4', '.', 'A', 'T1'],
    ],
  )
})

test('an unmet criterion refuses unless --accept-unmet, which records the ids', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--summary', 's')
      assert.equal(refused.status, 1)
      assert.match(refused.stdout, /✗ converge unmet 1/)
      assert.ok(existsSync(join(root, '.scratchpad', 'dossier', SLUG)))
      const done = await close(root, '--complete', '--accept-unmet', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /ds:close — START mode=complete carry=— converge=unmet:1 accepted/)
    },
    [['T1', 'x', 'A']],
    { criterion: '`false`' },
  )
})
