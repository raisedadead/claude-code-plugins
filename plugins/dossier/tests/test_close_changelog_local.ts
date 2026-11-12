import assert from 'node:assert/strict'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { cleanTemplates, close, DS, must, run, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('--plan runs the changelog check when the ledger root is a symlink', async () => {
  await within(
    async (root) => {
      const link = join(tmpdir(), `ds-close-link-${root.split('/').pop()}`)
      symlinkSync(root, link)
      try {
        const done = await run('sh', [DS, 'close', SLUG, '--complete', '--plan'], tmpdir(), { DOSSIER_LEDGER_ROOT: link })
        assert.equal(done.status, 0, done.stdout + done.stderr)
        assert.match(done.stdout, /⚠ no CHANGELOG\.md changed since the contract commit/)
      } finally {
        rmSync(link, { force: true })
      }
    },
    [['T1', 'x', 'A']],
    { changelog: true },
  )
})

test('--plan stays silent on the changelog advisory once a CHANGELOG.md changes after the contract', async () => {
  await within(
    async (root) => {
      mkdirSync(join(root, 'plugins', 'p'), { recursive: true })
      writeFileSync(join(root, 'plugins', 'p', 'CHANGELOG.md'), '# Changelog\n')
      await must('git', ['-C', root, 'add', '.'])
      await must('git', ['-C', root, 'commit', '-q', '-m', 'docs: changelog'])
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on the changelog advisory for a staged CHANGELOG.md not yet committed', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n')
      await must('git', ['-C', root, 'add', 'CHANGELOG.md'])
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on the changelog advisory for a CHANGELOG.md not yet added', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n')
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})
