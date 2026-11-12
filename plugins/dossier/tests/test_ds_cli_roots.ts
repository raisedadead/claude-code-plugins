import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { ds as inproc } from './inproc.ts'
import { template } from './repo.ts'

type Run = { status: number | null; stdout: string; stderr: string }

async function ds(cwd: string, args: string[], options: { env?: Record<string, string>; input?: string } = {}): Promise<Run> {
  const done = await inproc(cwd, args, options.env, options.input)
  return { status: done.code, stdout: done.stdout, stderr: done.stderr }
}

const primary = template((dir) => {
  const main = join(dir, 'repo')
  mkdirSync(main)
  execFileSync('git', ['-C', main, 'init', '-q', '-b', 'main'], { stdio: 'ignore' })
  execFileSync('git', ['-C', main, 'commit', '-q', '--allow-empty', '-m', 'init'], { stdio: 'ignore' })
})
afterAll(() => primary.clean())

test('a verb run from a linked worktree writes the primary checkout ledger', async () => {
  const base = primary.copy('ds-wt-')
  const main = join(base, 'repo')
  try {
    mkdirSync(join(main, '.scratchpad', 'dossier'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('worktree', 'add', '-q', join(base, 'repo.feature'), '-b', 'feature')
    const done = await ds(join(base, 'repo.feature'), ['regen-index'])
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'INDEX.md')))
    assert.ok(!existsSync(join(base, 'repo.feature', '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('with no ledger anywhere, the first ledger from a linked worktree lands in the primary checkout', async () => {
  const base = primary.copy('ds-wt-')
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    const root = await ds(feature, ['root'])
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${main}\n`)
    const done = await ds(feature, ['grill-add', '.scratchpad', 'probe', 'FACT: x cite=y'])
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'dossier', '.grill')))
    assert.ok(!existsSync(join(feature, '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('from a linked worktree, x-refresh reads the worktree repo and converge finds the wave contract', async () => {
  const base = primary.copy('ds-wt2-')
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
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    writeFileSync(join(feature, 'here.txt'), '')
    const refresh = await ds(feature, ['x-refresh', '.scratchpad/dossier/2026-10-03-w', 'app', '.'])
    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(readFileSync(join(wave, 'DOSSIER.md'), 'utf8'), /\| app \| feature \|/)
    const converge = await ds(feature, ['converge'])
    assert.match(converge.stdout, /CONVERGE: MET/, converge.stdout + converge.stderr)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('from a linked worktree, converge and the prompt state find a tracked contract on the feature branch', async () => {
  const base = primary.copy('ds-wt3-')
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const wave = join(main, '.scratchpad', 'dossier', '2026-10-09-w')
    mkdirSync(wave, { recursive: true })
    writeFileSync(join(wave, 'DOSSIER.md'), '# w\n\n`2026-10-09` · `live` · `P1/1`\n')
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    mkdirSync(join(feature, '.dossier'))
    writeFileSync(
      join(feature, '.dossier', '2026-10-09-w.md'),
      '# w\n\n| field | value |\n|---|---|\n| consumer | t |\n| budget | 5 commits |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `true` | exit 0 |\n',
    )
    execFileSync('git', ['-C', feature, 'add', '.dossier'], { stdio: 'ignore' })
    execFileSync('git', ['-C', feature, 'commit', '-q', '-m', 'contract'], { stdio: 'ignore' })
    const converge = await ds(feature, ['converge'])
    assert.match(converge.stdout, /contract: .*repo\.feature\/\.dossier\/2026-10-09-w\.md/, converge.stdout + converge.stderr)
    assert.match(converge.stdout, /CONVERGE: MET/)
    const state = await ds(main, ['convergence-state'], { input: JSON.stringify({ cwd: main, from: feature }) })
    assert.match(state.stdout, /wave w · 1 criteria/, state.stdout + state.stderr)
    assert.match(state.stdout, /commits: 0 of 5/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})
