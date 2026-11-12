import assert from 'node:assert/strict'
import { join } from 'node:path'
import { test as base } from 'vitest'
import { BLOCK, CLEAN, commit, crashed, git, init, line, NAG, out, run, seeded, USAGE, verdict, withRepo, write } from './tiger_kit.ts'

const test = base.concurrent

test('a clean run reports how many files it examined', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(10))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), 'TIGER: CLEAN 1 file')
  })
})

test('nothing staged says zero files', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(10))
    await git(repo, 'add', 'a.py')
    await commit(repo, 'chore: seed')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), 'TIGER: CLEAN 0 files')
  })
})

test('all staged files skipped is not nothing staged', async () => {
  await seeded(async (repo) => {
    write(repo, 'README.md', line(300))
    write(repo, 'data.json', line(300))
    await git(repo, 'add', 'README.md', 'data.json')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), 'TIGER: CLEAN 0 files, 2 skipped')
  })
})

test('an off-declared file counts as skipped, not examined', async () => {
  await seeded(async (repo) => {
    write(repo, '.editorconfig', '[*.py]\nmax_line_length = off\n')
    write(repo, 'wide.py', line(300))
    await git(repo, 'add', '.editorconfig', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.ok(result.stdout.includes('1 skipped'), result.stdout)
  })
})

test('an unusable env limit is announced, not swallowed', async () => {
  await seeded(async (repo) => {
    write(repo, 'wide.py', line(150))
    await git(repo, 'add', 'wide.py')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '0' })
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stderr.includes('WHETSTONE_TIGER_COLS'), result.stderr)
  })
})

test('an unusable editorconfig limit is announced, not swallowed', async () => {
  await seeded(async (repo) => {
    write(repo, '.editorconfig', '[*.py]\nmax_line_length = 0\n')
    write(repo, 'wide.py', line(150))
    await git(repo, 'add', '.editorconfig', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stderr.includes('max_line_length'), result.stderr)
  })
})

test('an unusable later section does not silently keep the earlier limit', async () => {
  await seeded(async (repo) => {
    write(repo, '.editorconfig', '[*]\nmax_line_length = 80\n\n[*.py]\nmax_line_length = 0\n')
    write(repo, 'wide.py', line(150))
    await git(repo, 'add', '.editorconfig', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 80'), result.stdout)
    assert.ok(result.stderr.includes('max_line_length'), result.stderr)
  })
})

test('a usable editorconfig limit stays silent on stderr', async () => {
  await seeded(async (repo) => {
    write(repo, '.editorconfig', '[*.py]\nmax_line_length = 40\n')
    write(repo, 'wide.py', line(150))
    await git(repo, 'add', '.editorconfig', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(!result.stderr.includes('max_line_length'), result.stderr)
  })
})

test('a usable env limit stays silent on stderr', async () => {
  await seeded(async (repo) => {
    write(repo, 'wide.py', line(150))
    await git(repo, 'add', 'wide.py')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '40' })
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(!result.stderr.includes('WHETSTONE_TIGER_COLS'), result.stderr)
  })
})

test('prose extensions are skipped', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'README.md', line(400))
    write(repo, 'data.json', line(400))
    await git(repo, 'add', 'README.md', 'data.json')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('a path outside any repo exits 64', async () => {
  await withRepo(async (dir) => {
    assert.equal((await run(dir)).status, USAGE)
  })
})

test('a missing git binary exits 64', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    const result = await run(repo, {}, { PATH: join(repo, 'no-such-dir') })
    assert.equal(result.status, USAGE, out(result))
    assert.ok(!crashed(result), result.stderr)
  })
})

const SKIPPED_FIXTURES = [
  'a.md',
  'a.markdown',
  'a.rst',
  'a.txt',
  'a.json',
  'a.jsonl',
  'a.csv',
  'a.tsv',
  'a.svg',
  'a.lock',
  'a.snap',
  'go.sum',
  'yarn.lock',
  'pnpm-lock.yaml',
  'poetry.lock',
  'Cargo.lock',
]

test('every skipped kind is actually skipped', async () => {
  await seeded(async (repo) => {
    for (const name of SKIPPED_FIXTURES) write(repo, name, line(300))
    await git(repo, 'add', ...SKIPPED_FIXTURES)
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), `TIGER: CLEAN 0 files, ${SKIPPED_FIXTURES.length} skipped`)
  })
})

test('a pnpm lockfile bump under a declared limit is skipped', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', '[*]\nmax_line_length = 100\n')
    write(repo, 'pnpm-lock.yaml', line(300))
    await git(repo, 'add', '.editorconfig', 'pnpm-lock.yaml')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.ok(!result.stdout.includes('pnpm-lock.yaml'), result.stdout)
  })
})

test('a lockfile name on neither list is measured like source', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', '[*]\nmax_line_length = 100\n')
    write(repo, 'gradle.lockfile', line(300))
    await git(repo, 'add', '.editorconfig', 'gradle.lockfile')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.equal(verdict(result), 'TIGER: BLOCK 1')
  })
})
