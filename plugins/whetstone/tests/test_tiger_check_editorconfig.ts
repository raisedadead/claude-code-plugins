import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test as base } from 'vitest'
import { BLOCK, CLEAN, crashed, git, init, line, NAG, out, run, verdict, withRepo, write } from './tiger_kit.ts'

const test = base.concurrent

test('env beats editorconfig', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*]\nmax_line_length = 200\n')
    write(repo, 'a.py', line(90))
    await git(repo, 'add', 'a.py', '.editorconfig')
    const result = await run(repo, { WHETSTONE_TIGER_COLS: '80' })
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 80'), result.stdout)
  })
})

test('a file named like ..x.py keeps the editorconfig limit', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*]\nmax_line_length = 40\n')
    write(repo, '..x.py', line(100))
    await git(repo, 'add', '..x.py', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 40'), result.stdout)
  })
})

test('an editorconfig section glob scopes by extension', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 79\n')
    write(repo, 'a.py', line(90))
    write(repo, 'b.js', line(90))
    await git(repo, 'add', 'a.py', 'b.js', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('a.py:1:'), result.stdout)
    assert.ok(!result.stdout.includes('b.js'), result.stdout)
    assert.ok(result.stdout.includes('TIGER: BLOCK 1'), result.stdout)
  })
})

test('editorconfig off skips the file', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = off\n')
    write(repo, 'a.py', line(300))
    write(repo, 'b.sh', line(120))
    await git(repo, 'add', 'a.py', 'b.sh', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(!result.stdout.includes('a.py'), result.stdout)
    assert.ok(result.stdout.includes('b.sh:1:'), result.stdout)
  })
})

test('mixed declared and fallback offences count only the declared', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 88\n')
    write(repo, 'a.py', line(95))
    write(repo, 'b.sh', line(120))
    await git(repo, 'add', 'a.py', 'b.sh', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('TIGER: BLOCK 1'), result.stdout)
    assert.ok(result.stdout.includes('a.py:1: 95 cols (limit 88)'), result.stdout)
    assert.ok(result.stdout.includes('b.sh:1: 120 cols (limit 100)'), result.stdout)
  })
})

test('the block count sums several declared offences', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 88\n')
    write(repo, 'a.py', line(95))
    write(repo, 'b.py', line(96) + line(10))
    write(repo, 'c.sh', line(120))
    await git(repo, 'add', 'a.py', 'b.py', 'c.sh', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('TIGER: BLOCK 2'), result.stdout)
    assert.ok(result.stdout.includes('c.sh:1: 120 cols (limit 100)'), result.stdout)
  })
})

test('the fallback only nags when editorconfig does not match', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 88\n')
    write(repo, 'b.sh', line(120))
    await git(repo, 'add', 'b.sh', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('TIGER: NAG 1'), result.stdout)
  })
})

test('an editorconfig above the repo root is not read', async () => {
  await withRepo(async (_, outer) => {
    writeFileSync(join(outer, '.editorconfig'), 'root = true\n\n[*.py]\nmax_line_length = 20\n')
    const repo = join(outer, 'inner')
    mkdirSync(repo)
    await init(repo)
    write(repo, 'src/a.py', line(120))
    await git(repo, 'add', 'src/a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('limit 100'), result.stdout)
  })
})

test('a nested editorconfig with a brace and a scoped glob', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*]\nmax_line_length = 200\n')
    write(repo, 'pkg/.editorconfig', '[*.{js,ts}]\nmax_line_length = 60\n')
    write(repo, 'pkg/a.ts', line(80))
    write(repo, 'pkg/b.py', line(80))
    await git(repo, 'add', '.editorconfig', 'pkg/.editorconfig', 'pkg/a.ts', 'pkg/b.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('pkg/a.ts:1: 80 cols (limit 60)'), result.stdout)
    assert.ok(!result.stdout.includes('b.py'), result.stdout)
  })
})

test('a non-ASCII filename still gets its declared limit', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 80\n')
    write(repo, 'café.py', line(96))
    await git(repo, 'add', 'café.py', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 80'), result.stdout)
  })
})

test('a Unicode digit editorconfig limit does not crash', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = ²\n')
    write(repo, 'a.py', line(120))
    await git(repo, 'add', 'a.py', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(!crashed(result), result.stderr)
  })
})

test('brace expansion is bounded', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', `root = true\n\n[${'{a,b}'.repeat(22)}*.py]\nmax_line_length = 80\n`)
    write(repo, 'a.py', line(120))
    await git(repo, 'add', 'a.py', '.editorconfig')
    const result = await run(repo)
    assert.ok(result.status === NAG || result.status === BLOCK, out(result))
  })
})

test('a negated bracket glob in editorconfig', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[file[!abc].py]\nmax_line_length = 80\n')
    write(repo, 'filex.py', line(96))
    write(repo, 'filea.py', line(96))
    await git(repo, 'add', 'filex.py', 'filea.py', '.editorconfig')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('filex.py'), result.stdout)
    assert.ok(result.stdout.includes('TIGER: BLOCK 1'), result.stdout)
  })
})

test('a filename with a space keeps its declared limit', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 40\n')
    write(repo, 'two words.py', line(90))
    await git(repo, 'add', '.editorconfig', 'two words.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('two words.py:1: 90 cols (limit 40)'), result.stdout)
  })
})

test('a star does not cross a directory boundary', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[src/*.py]\nmax_line_length = 40\n')
    write(repo, 'src/a.py', line(90))
    write(repo, 'src/sub/deep.py', line(90))
    await git(repo, 'add', '.editorconfig', 'src/a.py', 'src/sub/deep.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('src/a.py:1: 90 cols (limit 40)'), result.stdout)
    assert.ok(!result.stdout.includes('deep.py'), result.stdout)
  })
})

test('a question mark does not match a slash', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[a?c.py]\nmax_line_length = 40\n')
    write(repo, 'a/c.py', line(90))
    await git(repo, 'add', '.editorconfig', 'a/c.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('a bare glob still matches inside a subdirectory', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 40\n')
    write(repo, 'deep/nested/a.py', line(90))
    await git(repo, 'add', '.editorconfig', 'deep/nested/a.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 40'), result.stdout)
  })
})

test('an honoured off is never reported as ignored', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = off\n')
    write(repo, 'a.py', line(300))
    await git(repo, 'add', '.editorconfig', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, CLEAN, out(result))
    assert.ok(!result.stderr.includes('max_line_length'), result.stderr)
  })
})

test('editorconfig comments are not settings', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\n; max_line_length = 20\n# max_line_length = 20\nmax_line_length = 40\n')
    write(repo, 'a.py', line(30))
    await git(repo, 'add', '.editorconfig', 'a.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('a setting outside any section is not a glob', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\nmax_line_length = 20\n')
    write(repo, 'a.py', line(60))
    await git(repo, 'add', '.editorconfig', 'a.py')
    assert.equal((await run(repo)).status, CLEAN)
  })
})

test('the root config is reached past a non-root one', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*.py]\nmax_line_length = 40\n')
    write(repo, 'src/.editorconfig', '[*.js]\nmax_line_length = 200\n')
    write(repo, 'src/a.py', line(90))
    await git(repo, 'add', '.editorconfig', 'src/.editorconfig', 'src/a.py')
    const result = await run(repo)
    assert.equal(result.status, BLOCK, out(result))
    assert.ok(result.stdout.includes('limit 40'), result.stdout)
  })
})

test('an unparseable section glob is not read as a block', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[[!]]\nmax_line_length = 40\n')
    write(repo, 'a.py', line(120))
    await git(repo, 'add', '.editorconfig', 'a.py')
    const result = await run(repo)
    assert.equal(result.status, NAG, out(result))
    assert.ok(result.stdout.includes('TIGER: NAG 1'), result.stdout)
  })
})

test('a wildcard-heavy section glob does not hang', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, '.editorconfig', `root = true\n\n[${'*a'.repeat(12)}*b]\nmax_line_length = 40\n`)
    const name = 'a'.repeat(120) + '.py'
    write(repo, name, line(120))
    await git(repo, 'add', '.editorconfig', name)
    const result = await run(repo, {}, { ...process.env })
    assert.equal(result.status, NAG, out(result))
  })
})

test('a subdirectory root still reads the repo editorconfig', async () => {
  await withRepo(async (_, tmp) => {
    const repo = join(tmp, 'repo')
    mkdirSync(repo)
    await init(repo)
    write(repo, '.editorconfig', 'root = true\n\n[*]\nmax_line_length = 40\n')
    write(repo, 'sub/wide.py', line(60))
    await git(repo, 'add', 'sub/wide.py')
    const nested = await run(join(repo, 'sub'))
    assert.equal(verdict(nested), 'TIGER: BLOCK 1', out(nested))
    assert.equal(nested.status, BLOCK)
  })
})
