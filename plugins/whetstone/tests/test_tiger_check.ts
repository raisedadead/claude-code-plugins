import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { test as base } from 'vitest'

const test = base.concurrent
const execFileAsync = promisify(execFile)

const CHECK = join(import.meta.dirname, '..', 'skills', 'tiger-style', 'scripts', 'tiger-check-cli.ts')
const CLEAN = 0
const BLOCK = 1
const NAG = 2
const USAGE = 64

type Run = { status: number | null; stdout: string; stderr: string }

function gitEnv(ambient: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...ambient, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
}

async function exec(file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeout?: number }): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { ...options, encoding: 'utf8' })
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    return { status: typeof failed.code === 'number' ? failed.code : null, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' }
  }
}

async function gitWith(ambient: NodeJS.ProcessEnv, repo: string, ...args: string[]): Promise<void> {
  const done = await exec('git', args, { cwd: repo, env: gitEnv(ambient) })
  if (done.status !== 0) {
    const detail = done.stderr.trim() || done.stdout.trim() || 'no output'
    throw new assert.AssertionError({ message: `git ${args.join(' ')} exited ${done.status}: ${detail}` })
  }
}

function git(repo: string, ...args: string[]): Promise<void> {
  return gitWith(process.env, repo, ...args)
}

async function init(repo: string, ambient: NodeJS.ProcessEnv = process.env): Promise<void> {
  await gitWith(ambient, repo, 'init', '-q', '-b', 'main')
  await gitWith(ambient, repo, 'config', 'user.email', 't@example.com')
  await gitWith(ambient, repo, 'config', 'user.name', 't')
}

function commit(repo: string, message: string, ambient: NodeJS.ProcessEnv = process.env): Promise<void> {
  return gitWith(ambient, repo, 'commit', '-q', '-m', message)
}

function write(repo: string, rel: string, body: string): void {
  const path = join(repo, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

function run(repo: string, overrides: Record<string, string> = {}, env?: NodeJS.ProcessEnv): Promise<Run> {
  const base = env ?? gitEnv()
  delete base.WHETSTONE_TIGER_COLS
  return exec(process.execPath, [CHECK, repo], { env: { ...base, ...overrides }, timeout: 20_000 })
}

function line(width: number): string {
  return 'x'.repeat(width) + '\n'
}

function verdict(result: Run): string {
  const lines = result.stdout.split('\n').filter((l) => l.startsWith('TIGER:'))
  return lines[lines.length - 1] ?? ''
}

function out(result: Run): string {
  return result.stdout + result.stderr
}

function crashed(result: Run): boolean {
  return /^\s+at /m.test(result.stderr)
}

async function withRepo(body: (repo: string, tmp: string) => Promise<void>): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'tiger-'))
  try {
    await body(tmp, tmp)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

async function seeded(body: (repo: string) => Promise<void>): Promise<void> {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'seed.py', line(10))
    await git(repo, 'add', 'seed.py')
    await commit(repo, 'chore: seed')
    await body(repo)
  })
}

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

test('prose extensions are skipped', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'README.md', line(400))
    write(repo, 'data.json', line(400))
    await git(repo, 'add', 'README.md', 'data.json')
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

test('a path outside any repo exits 64', async () => {
  await withRepo(async (dir) => {
    assert.equal((await run(dir)).status, USAGE)
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

test('a missing git binary exits 64', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    const result = await run(repo, {}, { PATH: join(repo, 'no-such-dir') })
    assert.equal(result.status, USAGE, out(result))
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

test('combining marks do not widen a line', async () => {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'accents.py', 'é'.repeat(100) + '\n')
    await git(repo, 'add', 'accents.py')
    assert.equal((await run(repo)).status, CLEAN)
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
