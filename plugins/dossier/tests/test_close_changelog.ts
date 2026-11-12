import assert from 'node:assert/strict'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { cleanTemplates, close, ledger, must, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

async function changelogRepo(...dates: string[]): Promise<string> {
  const path = realpathSync(mkdtempSync(join(tmpdir(), 'ds-close-x-')))
  await must('git', ['-C', path, 'init', '-q', '-b', 'main'])
  for (const [at, date] of dates.entries()) {
    writeFileSync(join(path, 'CHANGELOG.md'), `# Changelog\n${at}\n`)
    await must('git', ['-C', path, 'add', '.'])
    await must('git', ['-C', path, 'commit', '-q', '-m', 'c', `--date=${date}`], undefined, { GIT_COMMITTER_DATE: date })
  }
  return path
}

async function withRepo(dates: string[], body: (stdout: string) => void, prepare = (_root: string): void => {}): Promise<void> {
  await within(
    async (root) => {
      const path = await changelogRepo(...dates)
      try {
        prepare(root)
        writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), ledger([['T1', 'x', 'A']], '', [path]))
        const done = await close(root, '--complete', '--plan')
        assert.equal(done.status, 0, done.stdout + done.stderr)
        body(done.stdout)
      } finally {
        rmSync(path, { recursive: true, force: true })
      }
    },
    [['T1', 'x', 'A']],
  )
}

test('--plan warns when an absolute-path repo keeps a CHANGELOG.md unchanged since the contract commit', async () => {
  await withRepo(['2000-01-01T00:00:00Z'], (stdout) => assert.match(stdout, /⚠ no CHANGELOG\.md changed since the contract commit/))
})

test('--plan stays silent once an absolute-path repo changes its CHANGELOG.md after the contract commit', async () => {
  await withRepo(['2000-01-01T00:00:00Z', '2090-01-01T00:00:00Z'], (stdout) => assert.doesNotMatch(stdout, /CHANGELOG/))
})

test('--plan stays silent when an absolute-path repo has no commit before the contract commit', async () => {
  await withRepo(['2090-01-01T00:00:00Z'], (stdout) => assert.doesNotMatch(stdout, /CHANGELOG/))
})

test('--plan stays silent when the contract repo adds its first CHANGELOG.md beside a repo that keeps one', async () => {
  await withRepo(
    ['2000-01-01T00:00:00Z'],
    (stdout) => assert.doesNotMatch(stdout, /CHANGELOG/),
    (root) => writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n'),
  )
})
