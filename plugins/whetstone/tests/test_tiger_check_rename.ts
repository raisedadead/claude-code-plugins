import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test as base } from 'vitest'
import { BLOCK, CLEAN, commit, git, init, line, NAG, out, run, seeded, verdict, withRepo, write } from './tiger_kit.ts'

const test = base.concurrent

test('an offence reports the real line number', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    const body = Array.from({ length: 20 }, (_, n) => `short ${n}\n`)
    write(repo, 'a.py', body.join(''))
    await git(repo, 'add', 'a.py')
    await commit(repo, 'chore: seed')
    body[9] = line(130)
    write(repo, 'a.py', body.join(''))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('a.py:10:'), result.stdout)
  })
})

test('an unborn HEAD still checks the index', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(120))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('a.py:1:'), result.stdout)
  })
})

test('a pure rename adds nothing', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'old.py', line(120).repeat(5))
    await git(repo, 'add', 'old.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'mv', 'old.py', 'new.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
  })
})

test('a rename plus a long line reports only the new line', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'old.py', line(120).repeat(5))
    await git(repo, 'add', 'old.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'mv', 'old.py', 'new.py')
    write(repo, 'new.py', line(120).repeat(5) + line(130))
    await git(repo, 'add', 'new.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('TIGER: NAG 1'), result.stdout)
    assert.ok(result.stdout.includes('130 cols'), result.stdout)
  })
})

test('a staged new file is seen', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'seed.txt', 'seed\n')
    await git(repo, 'add', 'seed.txt')
    await commit(repo, 'seed')
    write(repo, 'fresh.py', line(150))
    await git(repo, 'add', 'fresh.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('fresh.py:1:'), result.stdout)
  })
})

test('removed lines are ignored', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(300))
    await git(repo, 'add', 'a.py')
    await commit(repo, 'seed')
    write(repo, 'a.py', line(10))
    await git(repo, 'add', 'a.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('an unstaged change is not checked', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(10))
    await git(repo, 'add', 'a.py')
    await commit(repo, 'seed')
    write(repo, 'a.py', line(300))
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('no staged changes is clean', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(10))
    await git(repo, 'add', 'a.py')
    await commit(repo, 'seed')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('content mimicking a file header is not trusted', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'smuggle.py', 'a = 1\n++ b/decoy.md\n' + line(300))
    await git(repo, 'add', 'smuggle.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('smuggle.py'), result.stdout)
    assert.ok(!result.stdout.includes('decoy.md'), result.stdout)
  })
})

test('content mimicking a /dev/null header is not trusted', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'smuggle.py', 'a = 1\n++ /dev/null\n' + line(300))
    await git(repo, 'add', 'smuggle.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('smuggle.py'), result.stdout)
  })
})

test('the no-newline marker is not an added line', async () => {
  await seeded(async (repo) => {
    writeFileSync(join(repo, 'a.py'), 'x'.repeat(50))
    await git(repo, 'add', 'a.py')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '10' })
    assert.equal(result.status, BLOCK, out(result))
    assert.equal(verdict(result), 'TIGER: BLOCK 1')
  })
})

test('a staged deletion is not examined', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'gone.py', line(300))
    await git(repo, 'add', 'gone.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'rm', '-q', 'gone.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), 'TIGER: CLEAN 0 files')
  })
})

test('a rename is attributed to the new name', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'old.py', line(120).repeat(5))
    await git(repo, 'add', 'old.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'mv', 'old.py', 'new.py')
    write(repo, 'new.py', line(120).repeat(5) + line(130))
    await git(repo, 'add', 'new.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('new.py:6: 130 cols'), result.stdout)
    assert.ok(!result.stdout.includes('old.py'), result.stdout)
  })
})

test('a rename beside another change loses neither', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'old.py', line(10))
    write(repo, 'other.py', line(10))
    await git(repo, 'add', 'old.py', 'other.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'mv', 'old.py', 'new.py')
    write(repo, 'other.py', line(10) + line(140))
    await git(repo, 'add', 'new.py', 'other.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('other.py:2: 140 cols'), result.stdout)
  })
})

test('rename pairing survives renames being off', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    await git(repo, 'config', 'diff.renames', 'false')
    write(repo, 'old.py', line(130).repeat(5))
    await git(repo, 'add', 'old.py')
    await commit(repo, 'chore: seed')
    await git(repo, 'mv', 'old.py', 'new.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.equal(verdict(result), 'TIGER: CLEAN 1 file')
  })
})

test('a subdirectory root agrees with the work-tree top', async () => {
  await withRepo(async (_, tmp) => {
    const repo = join(tmp, 'repo')
    mkdirSync(repo)
    await init(repo)
    write(repo, 'sub/wide.py', line(150))
    await git(repo, 'add', 'sub/wide.py')
    const top = await run(repo)
    const nested = await run(join(repo, 'sub'))
    assert.equal(verdict(top), verdict(nested))
    assert.equal(top.status, nested.status)
  })
})
