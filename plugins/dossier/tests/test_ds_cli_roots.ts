import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')

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

test('with no ledger anywhere, the first ledger from a linked worktree lands in the primary checkout', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    mkdirSync(main)
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    const root = spawnSync('sh', [DS, 'root'], { cwd: join(feature), encoding: 'utf8' })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${main}\n`)
    const done = spawnSync('sh', [DS, 'grill-add', '.scratchpad', 'probe', 'FACT: x cite=y'], { cwd: feature, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'dossier', '.grill')))
    assert.ok(!existsSync(join(feature, '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('with no ledger, a submodule keeps its own directory and a bare primary roots beside the bare repo', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sub-')))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { stdio: 'ignore' })
  const root = (cwd: string) => spawnSync('sh', [DS, 'root'], { cwd, encoding: 'utf8' })
  try {
    for (const name of ['lib', 'sup']) {
      mkdirSync(join(base, name))
      git(join(base, name), 'init', '-q')
      git(join(base, name), 'commit', '-q', '--allow-empty', '-m', 'init')
    }
    git(join(base, 'sup'), 'submodule', 'add', '-q', join(base, 'lib'), 's')
    assert.equal(root(join(base, 'sup', 's')).stdout, `${join(base, 'sup', 's')}\n`)
    mkdirSync(join(base, 'lib', 'pkg'))
    assert.equal(root(join(base, 'lib', 'pkg')).stdout, `${join(base, 'lib')}\n`)
    git(base, 'clone', '-q', '--bare', join(base, 'lib'), join(base, 'bare', 'repo.git'))
    git(join(base, 'bare', 'repo.git'), 'worktree', 'add', '-q', join(base, 'bare', 'feat'))
    assert.equal(root(join(base, 'bare', 'feat')).stdout, `${join(base, 'bare')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a linked worktree of a primary with a separate git dir roots at itself and ignores a ledger in the git dir', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sep-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'ignore' })
  try {
    mkdirSync(join(base, 'store'))
    git(base, 'init', '-q', `--separate-git-dir=${join(base, 'store', 'sep.git')}`, 'sep')
    git(join(base, 'sep'), 'commit', '-q', '--allow-empty', '-m', 'init')
    git(join(base, 'sep'), 'worktree', 'add', '-q', join(base, 'sep.feat'))
    mkdirSync(join(base, 'sep', '.scratchpad', 'dossier'), { recursive: true })
    mkdirSync(join(base, 'store', 'sep.git', '.scratchpad', 'dossier'), { recursive: true })
    const root = spawnSync('sh', [DS, 'root'], { cwd: join(base, 'sep.feat'), encoding: 'utf8' })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${join(base, 'sep.feat')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('outside git, with no ledger, the ledger root is the current directory', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ds-nogit-')))
  try {
    const root = spawnSync('sh', [DS, 'root'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${dir}\n`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
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
      '| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `test -f here.txt` | exit 0 |\n',
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
