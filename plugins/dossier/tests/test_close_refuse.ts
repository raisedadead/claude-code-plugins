import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { archived, cleanTemplates, close, DS, live, must, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('a run without a summary or a mode is a usage error', async () => {
  await within(
    async (root) => {
      assert.equal((await close(root, '--complete')).status, 64)
      assert.equal((await close(root, '--summary', 's')).status, 64)
    },
    [['T1', 'x', 'A']],
  )
})

async function refusal(root: string, ...args: string[]): Promise<string> {
  const done = await close(root, ...args)
  assert.equal(done.status, 1, done.stdout + done.stderr)
  return done.stdout + done.stderr
}

test('a done row with no cite refuses --complete', async () => {
  await within(
    async (root) => {
      const file = join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md')
      writeFileSync(file, live(root).replace('| abc1234 |', '| — |'))
      assert.match(await refusal(root, '--complete', '--plan'), /✗ T1 done with no cite/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a successor that does not exist refuses', async () => {
  await within(async (root) => assert.match(await refusal(root, '--successor', 'ghost', '--plan'), /✗ successor ghost not found/), [['T1', 'x', 'A']])
})

test('a successor with no Tasks table refuses the carry and leaves §Z unwritten', async () => {
  await within(
    async (root) => {
      const next = join(root, '.scratchpad', 'dossier', '2026-10-10-next')
      mkdirSync(next)
      writeFileSync(join(next, 'DOSSIER.md'), '# next\n\n## Goal\n\ng\n')
      assert.match(await refusal(root, '--successor', 'next', '--carry', 'T2', '--summary', 's'), /successor 2026-10-10-next has no Tasks table/)
      assert.doesNotMatch(live(root), /^successor: next$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
    ],
  )
})

test('a held lock refuses a fresh close and a resume of a sealed one', async () => {
  await within(
    async (root) => {
      const dir = join(root, '.scratchpad', 'dossier', SLUG)
      writeFileSync(join(dir, '.ds-lock'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), skill: 'ds:build', target: 'T1' }))
      assert.match(await refusal(root, '--complete', '--summary', 's'), /✗ locked by ds:build/)
      await must('sh', [DS, 'z-write', dir, 'complete', '—', 'early', 'abc1234'], root)
      assert.match(await refusal(root, '--complete'), /✗ locked by ds:build/)
      assert.ok(existsSync(dir))
    },
    [['T1', 'x', 'A']],
  )
})

test('an unfinished close that started with another mode refuses', async () => {
  await within(
    async (root) => {
      await must('sh', [DS, 's-append', join(root, '.scratchpad', 'dossier', SLUG), 'ds:close — START mode=abandoned carry=— converge=skipped'], root)
      assert.match(await refusal(root, '--complete', '--summary', 's'), /an unfinished close started with another mode/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a merge in progress refuses the contract retire and leaves the close resumable', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, '.git', 'MERGE_HEAD'), await must('git', ['-C', root, 'rev-parse', 'HEAD']))
      assert.match(await refusal(root, '--complete', '--summary', 's'), /has a merge in progress/)
      assert.doesNotMatch(archived(root), /ds:close — DONE/)
      assert.ok(existsSync(join(root, '.dossier', `${SLUG}.md`)))
    },
    [['T1', 'x', 'A']],
  )
})

test('a contract that converge cannot parse refuses unless --accept-unmet', async () => {
  await within(
    async (root) => {
      writeFileSync(
        join(root, '.dossier', `${SLUG}.md`),
        '# wave\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `true` | exit 0 |\n',
      )
      assert.match(await refusal(root, '--complete', '--plan'), /✗ converge did not run/)
      const done = await close(root, '--complete', '--plan', '--accept-unmet')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /⚠ converge did not run: .* — accepted/)
    },
    [['T1', 'x', 'A']],
  )
})
