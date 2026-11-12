import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
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

function contract(command: string, budget = '5 commits'): string {
  return [
    '# wave',
    '',
    '| field | value |',
    '| --- | --- |',
    '| consumer | t |',
    `| budget | ${budget} |`,
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

type Wave = { root: string; path: string; close: () => Promise<Run> }

function contractPath(root: string): string {
  return join(root, '.dossier', `${SLUG}.md`)
}

const repo = template((root) => {
  git(root, 'init', '-q', '-b', 'main')
  writeFileSync(join(root, '.gitignore'), '.scratchpad/\n')
  const dir = join(root, '.scratchpad', 'dossier', SLUG)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), LEDGER)
  mkdirSync(join(root, '.dossier'))
  writeFileSync(contractPath(root), contract('test -f done.txt'))
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'add contract')
})

afterAll(() => repo.clean())

async function within(body: (wave: Wave) => Promise<void>): Promise<void> {
  const root = repo.copy('ds-close-edit-')
  try {
    const path = contractPath(root)
    const done = await run(['converge', '--baseline', path], root)
    assert.equal(done.status, 0, done.stdout)
    writeFileSync(join(root, 'done.txt'), '')
    await body({ root, path, close: () => run(['close', SLUG, '--complete', '--plan'], root) })
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function lines(result: Run, mark: string): string[] {
  return result.stdout.split('\n').filter((line) => line.trimStart().startsWith(mark))
}

test('a criterion edited in a commit beside other files refuses the close', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('true'))
    writeFileSync(join(root, 'other.txt'), 'x')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('a criterion edited in a contract-only commit closes and the edit is named', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    git(root, 'commit', '-q', '-am', 'edit criterion')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
    assert.equal(lines(result, '·').filter((line) => line.includes('contract-only')).length, 1, result.stdout)
  })
})

test('an uncommitted criterion edit refuses the close', async () => {
  await within(async ({ path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('an edit outside the done-when table in a mixed commit does not refuse', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('test -f done.txt', '9 commits'))
    writeFileSync(join(root, 'other.txt'), 'x')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
  })
})
