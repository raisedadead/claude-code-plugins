import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test as base } from 'vitest'

const test = base.concurrent
const execFileAsync = promisify(execFile)

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const SLUG = '2026-11-12-wave'
const ISOLATED = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', DS_CONVERGE_DEPTH: '' }

type Run = { status: number; stdout: string }

async function run(file: string, args: string[], cwd: string): Promise<Run> {
  try {
    const { stdout } = await execFileAsync(file, args, { cwd, encoding: 'utf8', env: { ...process.env, ...ISOLATED } })
    return { status: 0, stdout }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof failed.code !== 'number') throw error
    return { status: failed.code, stdout: `${failed.stdout ?? ''}${failed.stderr ?? ''}` }
  }
}

async function git(root: string, ...args: string[]): Promise<void> {
  const done = await run('git', ['-C', root, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], root)
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

async function within(tracked: boolean, body: (wave: Wave) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-close-edit-')))
  try {
    await git(root, 'init', '-q', '-b', 'main')
    writeFileSync(join(root, '.gitignore'), '.scratchpad/\n')
    const dir = join(root, '.scratchpad', 'dossier', SLUG)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'DOSSIER.md'), LEDGER)
    let path = join(dir, 'CONTRACT.md')
    if (tracked) {
      mkdirSync(join(root, '.dossier'))
      path = join(root, '.dossier', `${SLUG}.md`)
    }
    writeFileSync(path, contract('test -f done.txt'))
    await git(root, 'add', '.')
    await git(root, 'commit', '-q', '-m', 'add contract')
    const done = await run('sh', [DS, 'converge', '--baseline', path], root)
    assert.equal(done.status, 0, done.stdout)
    writeFileSync(join(root, 'done.txt'), '')
    await body({ root, path, close: () => run('sh', [DS, 'close', SLUG, '--complete', '--plan'], root) })
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

test('a criterion edited in a commit beside other files refuses the close', async () => {
  await within(true, async ({ root, path, close }) => {
    writeFileSync(path, contract('true'))
    writeFileSync(join(root, 'other.txt'), 'x')
    await git(root, 'add', '.')
    await git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('a criterion edited in a contract-only commit closes and the edit is named', async () => {
  await within(true, async ({ root, path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    await git(root, 'commit', '-q', '-am', 'edit criterion')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
    assert.equal(lines(result, '·').filter((line) => line.includes('contract-only')).length, 1, result.stdout)
  })
})

test('an uncommitted criterion edit refuses the close', async () => {
  await within(true, async ({ path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('an edit outside the done-when table in a mixed commit does not refuse', async () => {
  await within(true, async ({ root, path, close }) => {
    writeFileSync(path, contract('test -f done.txt', '9 commits'))
    writeFileSync(join(root, 'other.txt'), 'x')
    await git(root, 'add', '.')
    await git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
  })
})

test('an untracked contract gets a did-not-run line', async () => {
  await within(false, async ({ close }) => {
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.equal(lines(result, '·').filter((line) => line.includes('did not run')).length, 1, result.stdout)
  })
})
