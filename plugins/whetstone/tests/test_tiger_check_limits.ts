import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test as base } from 'vitest'
import { BLOCK, CLEAN, commit, crashed, git, gitEnv, gitWith, init, line, NAG, out, run, withRepo, write } from './tiger_kit.ts'

const test = base.concurrent

test('fixture git runs ignore a hostile global config', async () => {
  await withRepo(async (_, tmp) => {
    const hostile = join(tmp, 'gitconfig')
    writeFileSync(hostile, `[commit]\n\tgpgsign = true\n[gpg]\n\tformat = ssh\n[user]\n\tsigningkey = ${tmp}/absent.pub\n`)
    const repo = join(tmp, 'repo')
    mkdirSync(repo)
    const ambient = { ...process.env, GIT_CONFIG_GLOBAL: hostile }
    await init(repo, ambient)
    write(repo, 'a.py', line(10))
    await gitWith(ambient, repo, 'add', 'a.py')
    await commit(repo, 'chore: seed', ambient)
    const result = await run(repo, {}, gitEnv(ambient))
    assert.equal(result.status, CLEAN, out(result))
  })
})

test("a failed fixture git call carries git's own stderr", async () => {
  await withRepo(async (repo) => {
    await init(repo)
    await assert.rejects(git(repo, 'checkout', 'no-such-branch'), /no-such-branch/)
  })
})

test('clean under default', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(40))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.match(result.stdout, /TIGER: CLEAN/)
  })
})

test('nag over default with no declared limit', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(120))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('TIGER: NAG 1'), result.stdout)
    assert.ok(result.stdout.includes('a.py:1:'), result.stdout)
    assert.ok(result.stdout.includes('120 cols'), result.stdout)
  })
})

test('block at an env-declared limit', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(90))
    await git(repo, 'add', 'a.py')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '80' })
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('TIGER: BLOCK 1'), result.stdout)
    assert.ok(result.stdout.includes('limit 80'), result.stdout)
  })
})

test('a width exactly at the limit is allowed', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(100))
    await git(repo, 'add', 'a.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('a width one over the limit is reported', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(101))
    await git(repo, 'add', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('101 cols'), result.stdout)
  })
})

test('a filename with a space is still checked', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'two words.py', line(120))
    await git(repo, 'add', 'two words.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.startsWith('two words.py:1:'), result.stdout)
  })
})

test('a Unicode digit env limit does not crash', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'a.py', line(120))
    await git(repo, 'add', 'a.py')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '²' })
    assert.equal(result.status, NAG, out(result))
    assert.ok(!crashed(result), result.stderr)
  })
})

test('wide characters count two columns', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'wide.py', 'x = ' + '文'.repeat(60) + '\n')
    await git(repo, 'add', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('124 cols'), result.stdout)
  })
})

test('tabs count to the next tab stop', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'tabbed.py', 'xxx\t'.repeat(13) + '\n')
    await git(repo, 'add', 'tabbed.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('104 cols'), result.stdout)
  })
})

test('combining marks do not widen a line', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'accents.py', 'é'.repeat(100) + '\n')
    await git(repo, 'add', 'accents.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('fullwidth characters count as two columns', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'wide.py', 'Ａ'.repeat(51) + '\n')
    await git(repo, 'add', 'wide.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('102 cols'), result.stdout)
  })
})
