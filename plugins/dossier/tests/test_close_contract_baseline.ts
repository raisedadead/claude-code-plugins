import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ds } from './inproc.ts'
import { template } from './repo.ts'

const SLUG = '2026-11-12-wave'
const ISOLATED = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', DS_CONVERGE_DEPTH: '' }

type Run = { status: number; stdout: string }

async function run(args: string[], cwd: string): Promise<Run> {
  const done = await ds(cwd, args, ISOLATED)
  return { status: done.code, stdout: done.code === 0 ? done.stdout : `${done.stdout}${done.stderr}` }
}

function git(root: string, ...args: string[]): void {
  const ran = spawnSync('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8', env: { ...process.env, ...ISOLATED } })
  const done = { status: ran.status, stdout: `${ran.stdout}${ran.stderr}` }
  assert.equal(done.status, 0, done.stdout)
}

function contract(command: string): string {
  return [
    '# wave',
    '',
    '| field | value |',
    '| --- | --- |',
    '| consumer | t |',
    '| budget | 5 commits |',
    '',
    '## done-when',
    '',
    '| id | command | expect |',
    '| --- | --- | --- |',
    `| 1 | \`${command}\` | exit 0 |`,
    '',
  ].join('\n')
}

const LEDGER = [
  '# wave',
  '',
  '`2026-11-12` · `live`',
  '',
  '## Tasks',
  '',
  '| id | state | who | task | needs | cite | verify |',
  '|----|-------|-----|------|-------|------|--------|',
  '| T1 | x | A | task | — | abc1234 | v |',
  '',
  '## Status',
  '',
  '2026-11-12 09:00 ds:new — created slug=wave',
  '',
  '## Closeout',
  '',
  '_(empty — written by ds:close)_',
  '',
].join('\n')

type Wave = { root: string; close: () => Promise<Run> }

function contractPath(root: string, tracked: boolean): string {
  return tracked ? join(root, '.dossier', `${SLUG}.md`) : join(root, '.scratchpad', 'dossier', SLUG, 'CONTRACT.md')
}

function build(root: string, tracked: boolean): void {
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, '.gitignore'), '.scratchpad/\n')
  const dir = join(root, '.scratchpad', 'dossier', SLUG)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), LEDGER)
  if (tracked) mkdirSync(join(root, '.dossier'))
  writeFileSync(contractPath(root, tracked), contract('test -f done.txt'))
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'add contract')
}

const repos = { tracked: template((root) => build(root, true)), untracked: template((root) => build(root, false)) }

afterAll(() => {
  repos.tracked.clean()
  repos.untracked.clean()
})

async function within(tracked: boolean, body: (wave: Wave) => Promise<void>): Promise<void> {
  const root = repos[tracked ? 'tracked' : 'untracked'].copy('ds-close-edit-')
  try {
    const done = await run(['converge', '--baseline', contractPath(root, tracked)], root)
    assert.equal(done.status, 0, done.stdout)
    writeFileSync(join(root, 'done.txt'), '')
    await body({ root, close: () => run(['close', SLUG, '--complete', '--plan'], root) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function lines(result: Run, mark: string): string[] {
  return result.stdout.split('\n').filter((line) => line.trimStart().startsWith(mark))
}

test('a clean baseline and an untouched contract close with no contract findings', async () => {
  await within(true, async ({ close }) => {
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(
      lines(result, '⚠').filter((line) => line.includes('baseline')),
      [],
    )
    assert.deepEqual(lines(result, '✗'), [])
  })
})

test('a wave whose §S has no baseline line gets a warning that does not block', async () => {
  await within(true, async ({ root, close }) => {
    const ledger = join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md')
    writeFileSync(ledger, readFileSync(ledger, 'utf8').replace(/^.*ds:converge — baseline.*\n\n?/m, ''))
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.equal(lines(result, '⚠').filter((line) => line.includes('baseline')).length, 1, result.stdout)
  })
})

test('an untracked contract gets a did-not-run line', async () => {
  await within(false, async ({ close }) => {
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.equal(lines(result, '·').filter((line) => line.includes('did not run')).length, 1, result.stdout)
  })
})
