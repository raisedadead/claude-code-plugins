import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const REGISTRY = [
  { id: 'V1', pattern: 'eval\\(', message: 'no eval', paths: ['src/*.py'] },
  { id: 'V9', pattern: '(?x) a b' },
]

function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-cli-'))
  try {
    mkdirSync(join(root, '.scratchpad', 'dossier'), { recursive: true })
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify(REGISTRY))
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function check(root: string, filePath: string, text: string) {
  const input = JSON.stringify({ file_path: filePath, chunks: [text] })
  return spawnSync('sh', [DS, 'invariant-check', root], { input, encoding: 'utf8' })
}

test('invariant-check exits 1 with the reason on a registered pattern', () => {
  withRoot((root) => {
    const done = check(root, 'src/app.py', 'x = eval(y)')
    assert.equal(done.status, 1, done.stderr)
    assert.match(done.stdout, /violates §V V1/)
  })
})

test('invariant-check exits 0 off the pattern and off the scope, and names a skipped pattern', () => {
  withRoot((root) => {
    const clean = check(root, 'src/app.py', 'x = safe(y)')
    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /§V V9 not checked/)
    assert.equal(check(root, 'lib/app.py', 'eval(').status, 0)
  })
})

test('invariant-check exits 0 on a malformed registry or payload', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), 'not json')
    assert.equal(check(root, 'src/app.py', 'eval(').status, 0)
  })
  withRoot((root) => {
    const done = spawnSync('sh', [DS, 'invariant-check', root], { input: 'garbage', encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
  })
})

test('ds exits 64 on an unknown verb', () => {
  assert.equal(spawnSync('sh', [DS, 'nope'], { encoding: 'utf8' }).status, 64)
})

test('ds exits 69 when node is not on PATH', () => {
  const done = spawnSync('/bin/sh', [DS, 'invariant-check'], { encoding: 'utf8', env: { PATH: '/nonexistent' } })
  assert.equal(done.status, 69)
  assert.match(done.stderr, /node 22\.18\+ required/)
})

test('a verb run from a linked worktree writes the primary checkout ledger', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt-')))
  const main = join(base, 'repo')
  try {
    mkdirSync(join(main, '.scratchpad', 'dossier'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', join(base, 'repo.feature'), '-b', 'feature')
    const done = spawnSync('sh', [DS, 'regen-index'], { cwd: join(base, 'repo.feature'), encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'INDEX.md')))
    assert.ok(!existsSync(join(base, 'repo.feature', '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('from a linked worktree, x-refresh reads the worktree repo and converge finds the wave contract', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt2-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const wave = join(main, '.scratchpad', 'dossier', '2026-10-03-w')
    mkdirSync(wave, { recursive: true })
    writeFileSync(
      join(wave, 'DOSSIER.md'),
      '# w\n\n`2026-10-03` · `live` · `P1/1`\n\n## Repos\n\n| repo | branch | ahead | tag | pushed | notes |\n|------|--------|-------|-----|--------|-------|\n| app | main | 0 | — | no | |\n',
    )
    writeFileSync(
      join(wave, 'CONTRACT.md'),
      '| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | \`test -f here.txt\` | exit 0 |\n',
    )
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    writeFileSync(join(feature, 'here.txt'), '')
    const refresh = spawnSync('sh', [DS, 'x-refresh', '.scratchpad/dossier/2026-10-03-w', 'app', '.'], { cwd: feature, encoding: 'utf8' })
    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(readFileSync(join(wave, 'DOSSIER.md'), 'utf8'), /\| app \| feature \|/)
    const converge = spawnSync('sh', [DS, 'converge'], { cwd: feature, encoding: 'utf8' })
    assert.match(converge.stdout, /CONVERGE: MET/, converge.stdout + converge.stderr)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a criterion does not inherit the ledger root ds set for itself, and keeps one the caller set', () => {
  withRoot((root) => {
    const wave = join(root, '.scratchpad', 'dossier', '2026-10-09-w')
    mkdirSync(wave)
    writeFileSync(join(wave, 'DOSSIER.md'), '# w\n\n`2026-10-09` · `live` · `P1/1`\n')
    const probe = '`test -z "$DOSSIER_LEDGER_ROOT$DOSSIER_SCRATCHPAD_ROOT"`'
    writeFileSync(
      join(wave, 'CONTRACT.md'),
      `| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | ${probe} | exit 0 |\n`,
    )
    const env = { ...process.env }
    delete env.DOSSIER_LEDGER_ROOT
    delete env.DOSSIER_SCRATCHPAD_ROOT
    const clean = spawnSync('sh', [DS, 'converge'], { cwd: root, encoding: 'utf8', env })
    assert.match(clean.stdout, /CONVERGE: MET/, clean.stdout + clean.stderr)
    const given = spawnSync('sh', [DS, 'converge', join(wave, 'CONTRACT.md')], { cwd: root, encoding: 'utf8', env: { ...env, DOSSIER_LEDGER_ROOT: '/given' } })
    assert.match(given.stdout, /UNMET 1/, given.stdout + given.stderr)
  })
})

test('from a linked worktree, converge and the prompt state find a tracked contract on the feature branch', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt3-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const wave = join(main, '.scratchpad', 'dossier', '2026-10-09-w')
    mkdirSync(wave, { recursive: true })
    writeFileSync(join(wave, 'DOSSIER.md'), '# w\n\n`2026-10-09` · `live` · `P1/1`\n')
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    mkdirSync(join(feature, '.dossier'))
    writeFileSync(
      join(feature, '.dossier', '2026-10-09-w.md'),
      '# w\n\n| field | value |\n|---|---|\n| consumer | t |\n| budget | 5 commits |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `true` | exit 0 |\n',
    )
    execFileSync('git', ['-C', feature, 'add', '.dossier'], { stdio: 'ignore' })
    execFileSync('git', ['-C', feature, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'contract'], { stdio: 'ignore' })
    const converge = spawnSync('sh', [DS, 'converge'], { cwd: feature, encoding: 'utf8' })
    assert.match(converge.stdout, /contract: .*repo\.feature\/\.dossier\/2026-10-09-w\.md/, converge.stdout + converge.stderr)
    assert.match(converge.stdout, /CONVERGE: MET/)
    const state = spawnSync('sh', [DS, 'convergence-state'], { cwd: main, encoding: 'utf8', input: JSON.stringify({ cwd: main, from: feature }) })
    assert.match(state.stdout, /wave w · 1 criteria/, state.stdout + state.stderr)
    assert.match(state.stdout, /commits: 0 of 5/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

function wave(root: string, rel: string, token: string, closeout = ''): void {
  const dir = join(root, '.scratchpad', 'dossier', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), `# w\n\n\`2026-10-09\` · \`${token}\` · \`P1/1\`\n\n## Closeout\n\n${closeout}\n`)
}

test('ds-check names a hand-closed archive and a contract with no open wave, and exits 0 on them', () => {
  withRoot((root) => {
    wave(root, '_archive/2026-09-29-handmade', 'done', 'closed by hand')
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier'))
    writeFileSync(join(root, '.dossier', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = spawnSync('sh', [DS, 'ds-check', '.scratchpad'], { cwd: root, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.deepEqual(done.stdout.trim().split('\n'), [
      'advisory: 2026-09-29-handmade is archived with no §Z closure key — `ds close` on it writes one',
      'advisory: .dossier/2026-09-28-proper.md belongs to no open wave — move it to .dossier/_archive/',
    ])
  })
})

test('ds-check prints nothing on a tree whose archives and contracts agree', () => {
  withRoot((root) => {
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier', '_archive'), { recursive: true })
    writeFileSync(join(root, '.dossier', '_archive', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = spawnSync('sh', [DS, 'ds-check', '.scratchpad'], { cwd: root, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.stdout, '')
  })
})
