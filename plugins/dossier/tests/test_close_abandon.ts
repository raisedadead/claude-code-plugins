import assert from 'node:assert/strict'
import { chmodSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { archived, cleanTemplates, close, lastSubject, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('an open bug refuses --complete, and --abandon closes over open rows and bugs', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--plan')
      const stop = "pause the wave (ds:status pause wave); --abandon only on the operator's say-so"
      assert.ok(refused.stdout.includes(`✗ T2 open — finish them, or ${stop}`), refused.stdout)
      assert.ok(refused.stdout.includes(`✗ B1 has no fix cite — ds:backprop B1, or ${stop}`), refused.stdout)
      const done = await close(root, '--abandon', 'dropped', '--summary', 'not needed')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /^abandoned: true$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'A'],
    ],
    { bugs: '| B1 | b | r | — | — |' },
  )
})

test('an open operator row is offered --carry', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--plan')
      assert.ok(refused.stdout.includes('✗ T2 open — finish them, --carry them, or pause the wave'), refused.stdout)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
    ],
  )
})

test('a refused contract commit leaves the close resumable, and the rerun commits the move', async () => {
  await within(
    async (root) => {
      const hook = join(root, '.git', 'hooks', 'pre-commit')
      writeFileSync(hook, '#!/bin/sh\nexit 1\n')
      chmodSync(hook, 0o755)
      const first = await close(root, '--complete', '--summary', 's')
      assert.equal(first.status, 1, first.stdout + first.stderr)
      assert.doesNotMatch(archived(root), /ds:close — DONE/)
      rmSync(hook)
      const second = await close(root, '--complete')
      assert.equal(second.status, 0, second.stdout + second.stderr)
      assert.equal(await lastSubject(root), `chore(dossier): archive wave contract ${SLUG}`)
      assert.match(archived(root), /ds:close — DONE/)
    },
    [['T1', 'x', 'A']],
  )
})
