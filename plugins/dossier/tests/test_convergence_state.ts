import assert from 'node:assert/strict'
import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { test } from 'node:test'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')

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

type Run = SpawnSyncReturns<string>

function run(payload: unknown, timeout = 10_000): Run {
  const input = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return spawnSync('sh', [DS, 'convergence-state'], { input, encoding: 'utf8', timeout })
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

function withTmp(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'convergence-state-'))
  try {
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('a repo with no contract says nothing', () => {
  withTmp((root) => {
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('a repo with a contract names the wave', () => {
  withTmp((root) => {
    repoWithContract(root)
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('demo-wave'), result.stdout)
  })
})

test('it reports criteria count without running them', () => {
  withTmp((root) => {
    repoWithContract(root)
    const marker = join(root, 'ran-marker')
    tracked(root, '2026-08-01-demo-wave.md', CONTRACT.replace('| 1   | `true`  | exit 0 |', `| 1   | \`touch ${marker}\` | exit 0 |`))
    const result = run({ cwd: root })
    assert.ok(result.stdout.includes('2 criteria'), result.stdout)
    assert.ok(!existsSync(marker), 'the hook ran a contract criterion')
  })
})

test('it reports budget usage', () => {
  withTmp((root) => {
    repoWithContract(root)
    assert.ok(run({ cwd: root }).stdout.includes('commits: 0 of 4'))
    writeFileSync(join(root, 'later.py'), 'x = 1\n')
    git(root, 'add', 'later.py')
    git(root, 'commit', '-q', '-m', 'feat: one more')
    assert.ok(run({ cwd: root }).stdout.includes('commits: 1 of 4'))
  })
})

test('malformed stdin never breaks the prompt', () => {
  const result = run('this is not json')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('empty stdin never breaks the prompt', () => {
  const result = run('')
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('a missing cwd never breaks the prompt', () => {
  const result = run({ cwd: '/nonexistent/path/for/a/test' })
  assert.equal(result.status, 0, result.stderr)
  assert.equal(result.stdout, '', result.stdout)
})

test('a contract outside a git repo still reports', () => {
  withTmp((root) => {
    tracked(root, 'x-demo-wave.md', CONTRACT)
    liveLedger(root, 'demo-wave')
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('demo-wave'), result.stdout)
  })
})

test('a contract with no criteria says nothing', () => {
  withTmp((root) => {
    tracked(root, 'broken.md', 'nothing here\n')
    liveLedger(root, 'broken')
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('an unreadable contract never breaks the prompt', () => {
  if (process.getuid?.() === 0) return
  withTmp((root) => {
    const contract = tracked(root, '2026-08-01-locked.md', CONTRACT)
    chmodSync(contract, 0o000)
    liveLedger(root, 'locked')
    let result: Run
    try {
      result = run({ cwd: root })
    } finally {
      chmodSync(contract, 0o600)
    }
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('it reports the layer mix of recent work', () => {
  withTmp((root) => {
    repoWithContract(root)
    writeFileSync(join(root, 'a.py'), 'x = 1\n')
    writeFileSync(join(root, 'README.md'), 'hi\n')
    mkdirSync(join(root, 'tests'))
    writeFileSync(join(root, 'tests', 'test_a.py'), 'y = 2\n')
    git(root, 'add', 'a.py', 'README.md', 'tests/test_a.py')
    git(root, 'commit', '-q', '-m', 'feat: work')
    const result = run({ cwd: root })
    assert.ok(result.stdout.includes('runtime 1 · tests 1 · docs 1'), result.stdout)
  })
})

test('a path merely containing test is runtime', () => {
  withTmp((root) => {
    repoWithContract(root)
    writeFileSync(join(root, 'latest.py'), 'x = 1\n')
    git(root, 'add', 'latest.py')
    git(root, 'commit', '-q', '-m', 'feat: latest')
    const result = run({ cwd: root })
    assert.ok(result.stdout.includes('runtime 1 · tests 0 · docs 0'), result.stdout)
  })
})

test('a contractless live wave is named', () => {
  withTmp((root) => {
    initRepo(root)
    ledger(root, '2026-08-01-demo')
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('demo'), result.stdout)
    assert.ok(result.stdout.includes('no contract'), result.stdout)
  })
})

test('a contractless archived wave is not named', () => {
  withTmp((root) => {
    ledger(root, join('_archive', '2026-07-01-old'), 'done')
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('the live wave is reported not the alphabetical last', () => {
  withTmp((root) => {
    initRepo(root)
    tracked(root, '2026-08-01-aaa-live.md', CONTRACT.replace('demo-wave', 'aaa-live'))
    tracked(root, '2026-08-01-zzz-closed.md', CONTRACT.replace('demo-wave', 'zzz-closed'))
    ledger(root, '2026-08-01-aaa-live')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'chore: two contracts')
    const result = run({ cwd: root })
    assert.ok(result.stdout.includes('aaa-live'), result.stdout)
    assert.ok(!result.stdout.includes('zzz-closed'), result.stdout)
  })
})

test('a same-slug successor reports the live wave', () => {
  withTmp((root) => {
    const old = CONTRACT.replace('demo-wave', 'rails')
    const next = old.replace('| 2   | `false` | exit 1 |', '| 2   | `false` | exit 1 |\n| 3   | `true`  | exit 0 |')
    tracked(root, '2026-08-01-rails.md', old)
    tracked(root, '2026-08-05-rails.md', next)
    ledger(root, '2026-08-05-rails')
    const result = run({ cwd: root })
    assert.ok(result.stdout.includes('3 criteria'), result.stdout)
    assert.ok(!result.stdout.includes('2 criteria'), result.stdout)
  })
})

test('a wave dir contract is reported', () => {
  withTmp((root) => {
    writeFileSync(join(ledger(root, '2026-08-01-solo'), 'CONTRACT.md'), CONTRACT)
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.stdout.includes('2 criteria'), result.stdout)
    assert.ok(!result.stdout.includes('no contract'), result.stdout)
  })
})

test('no live wave means silence', () => {
  withTmp((root) => {
    tracked(root, '2026-08-01-done.md', CONTRACT)
    const result = run({ cwd: root })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout, '', result.stdout)
  })
})

test('it finishes fast enough to sit on every prompt', () => {
  withTmp((root) => {
    repoWithContract(root)
    const started = performance.now()
    const result = run({ cwd: root }, 5_000)
    const elapsed = (performance.now() - started) / 1000
    assert.ok(result.stdout.includes('demo-wave'), result.stdout)
    assert.ok(elapsed < 1.0, `took ${elapsed.toFixed(2)}s on a two-commit repo`)
  })
})
