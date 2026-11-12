import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'vitest'
import { ds, type Run } from './inproc.ts'

const CONTRACT = [
  '# demo-wave',
  '',
  '| field    | value     |',
  '| -------- | --------- |',
  '| consumer | the tests |',
  '| budget   | 4 commits |',
  '',
  '## done-when',
  '',
  '| id  | command | expect |',
  '| --- | ------- | ------ |',
  '| 1   | `true`  | exit 0 |',
  '| 2   | `false` | exit 1 |',
  '',
].join('\n')

function run(payload: unknown): Promise<Run> {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return ds(process.cwd(), ['convergence-state'], {}, input)
}

function git(repo: string, ...args: string[]): void {
  const done = spawnSync('git', args, { cwd: repo, encoding: 'utf8' })
  assert.equal(done.status, 0, `git ${args.join(' ')}: ${done.stderr}`)
}

function initRepo(root: string): void {
  git(root, 'init', '-q', '-b', 'main')
  git(root, 'config', 'user.email', 't@example.com')
  git(root, 'config', 'user.name', 't')
}

function ledger(root: string, dirname: string, state = 'live'): string {
  const dir = join(root, '.scratchpad', 'dossier', dirname)
  mkdirSync(dir, { recursive: true })
  const name = basename(dirname)
  writeFileSync(join(dir, 'DOSSIER.md'), [`# ${name.slice(11)}`, '', `\`${name.slice(0, 10)}\` · \`${state}\` · \`P1/1\``, ''].join('\n'))
  return dir
}

function liveLedger(root: string, slug: string): void {
  ledger(root, `2026-08-01-${slug}`)
}

function tracked(root: string, name: string, text: string): string {
  mkdirSync(join(root, '.dossier'), { recursive: true })
  const path = join(root, '.dossier', name)
  writeFileSync(path, text)
  return path
}

function repoWithContract(root: string): void {
  initRepo(root)
  tracked(root, '2026-08-01-demo-wave.md', CONTRACT)
  liveLedger(root, 'demo-wave')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'chore: contract')
}

async function withTmp(body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'convergence-state-'))
  try {
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a repo with no contract says nothing', async () => {
  await withTmp(async (root) => {
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('a repo with a contract names the wave', async () => {
  await withTmp(async (root) => {
    repoWithContract(root)
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('demo-wave'), result.stdout)
  })
})

test('it reports criteria count without running them', async () => {
  await withTmp(async (root) => {
    repoWithContract(root)
    const marker = join(root, 'ran-marker')
    tracked(root, '2026-08-01-demo-wave.md', CONTRACT.replace('| 1   | `true`  | exit 0 |', `| 1   | \`touch ${marker}\` | exit 0 |`))
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('2 criteria'), result.stdout)
    assert.ok(!existsSync(marker), 'the hook ran a contract criterion')
  })
})

test('it reports budget usage', async () => {
  await withTmp(async (root) => {
    repoWithContract(root)
    assert.ok((await run({ cwd: root })).stdout.includes('commits: 0 of 4'))
    writeFileSync(join(root, 'later.py'), 'x = 1\n')
    git(root, 'add', 'later.py')
    git(root, 'commit', '-q', '-m', 'feat: one more')
    assert.ok((await run({ cwd: root })).stdout.includes('commits: 1 of 4'))
  })
})

test('malformed stdin never breaks the prompt', async () => {
  const result = await run('this is not json')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('empty stdin never breaks the prompt', async () => {
  const result = await run('')
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('a missing cwd never breaks the prompt', async () => {
  const result = await run({ cwd: '/nonexistent/path/for/a/test' })
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('a contract outside a git repo still reports', async () => {
  await withTmp(async (root) => {
    tracked(root, 'x-demo-wave.md', CONTRACT)
    liveLedger(root, 'demo-wave')
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('demo-wave'), result.stdout)
  })
})

test('a contract with no criteria says nothing', async () => {
  await withTmp(async (root) => {
    tracked(root, 'broken.md', 'nothing here\n')
    liveLedger(root, 'broken')
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('an unreadable contract never breaks the prompt', async () => {
  if (process.getuid?.() === 0) return
  await withTmp(async (root) => {
    const contract = tracked(root, '2026-08-01-locked.md', CONTRACT)
    chmodSync(contract, 0o000)
    liveLedger(root, 'locked')
    let result: Run
    try {
      result = await run({ cwd: root })
    } finally {
      chmodSync(contract, 0o600)
    }
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('it reports the layer mix of recent work', async () => {
  await withTmp(async (root) => {
    repoWithContract(root)
    writeFileSync(join(root, 'a.py'), 'x = 1\n')
    writeFileSync(join(root, 'README.md'), 'hi\n')
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'tests', 'test_a.py'), 'y = 2\n')
    git(root, 'add', 'a.py', 'README.md', 'tests/test_a.py')
    git(root, 'commit', '-q', '-m', 'feat: work')
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('runtime 1 · tests 1 · docs 1'), result.stdout)
  })
})

test('a path merely containing test is runtime', async () => {
  await withTmp(async (root) => {
    repoWithContract(root)
    writeFileSync(join(root, 'latest.py'), 'x = 1\n')
    git(root, 'add', 'latest.py')
    git(root, 'commit', '-q', '-m', 'feat: latest')
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('runtime 1 · tests 0 · docs 0'), result.stdout)
  })
})

test('a contractless live wave is named', async () => {
  await withTmp(async (root) => {
    initRepo(root)
    ledger(root, '2026-08-01-demo')
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('demo'), result.stdout)
    assert.ok(result.stdout.includes('no contract'), result.stdout)
  })
})

test('a contractless archived wave is not named', async () => {
  await withTmp(async (root) => {
    ledger(root, join('_archive', '2026-07-01-old'), 'done')
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('the live wave is reported not the alphabetical last', async () => {
  await withTmp(async (root) => {
    initRepo(root)
    tracked(root, '2026-08-01-aaa-live.md', CONTRACT.replace('demo-wave', 'aaa-live'))
    tracked(root, '2026-08-01-zzz-closed.md', CONTRACT.replace('demo-wave', 'zzz-closed'))
    ledger(root, '2026-08-01-aaa-live')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'chore: two contracts')
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('aaa-live'), result.stdout)
    assert.ok(!result.stdout.includes('zzz-closed'), result.stdout)
  })
})

test('a same-slug successor reports the live wave', async () => {
  await withTmp(async (root) => {
    const old = CONTRACT.replace('demo-wave', 'rails')
    const next = old.replace('| 2   | `false` | exit 1 |', '| 2   | `false` | exit 1 |\n| 3   | `true`  | exit 0 |')
    tracked(root, '2026-08-01-rails.md', old)
    tracked(root, '2026-08-05-rails.md', next)
    ledger(root, '2026-08-05-rails')
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('3 criteria'), result.stdout)
    assert.ok(!result.stdout.includes('2 criteria'), result.stdout)
  })
})

test('a wave dir contract is reported', async () => {
  await withTmp(async (root) => {
    writeFileSync(join(ledger(root, '2026-08-01-solo'), 'CONTRACT.md'), CONTRACT)
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.ok(result.stdout.includes('2 criteria'), result.stdout)
    assert.ok(!result.stdout.includes('no contract'), result.stdout)
  })
})

test('no live wave means silence', async () => {
  await withTmp(async (root) => {
    tracked(root, '2026-08-01-done.md', CONTRACT)
    const result = await run({ cwd: root })
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('it finishes fast enough to sit on every prompt', async () => {
  await withTmp(async (root) => {
    initRepo(root)
    const markers = [join(root, 'ran-1'), join(root, 'ran-2')]
    const slow = CONTRACT.replace('| 1   | `true`  | exit 0 |', `| 1   | \`touch ${markers[0]}\` | exit 0 |`).replace(
      '| 2   | `false` | exit 1 |',
      `| 2   | \`touch ${markers[1]}\` | exit 1 |`,
    )
    tracked(root, '2026-08-01-demo-wave.md', slow)
    liveLedger(root, 'demo-wave')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'chore: contract')
    const result = await run({ cwd: root })
    assert.ok(result.stdout.includes('wave demo-wave · 2 criteria'), result.stdout)
    assert.deepEqual(
      markers.filter((marker) => existsSync(marker)),
      [],
      'the hook ran a contract criterion',
    )
  })
})
