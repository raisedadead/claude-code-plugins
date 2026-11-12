import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds as inproc } from './inproc.ts'

type Run = { status: number | null; stdout: string; stderr: string }

async function ds(cwd: string, args: string[], options: { env?: Record<string, string> } = {}): Promise<Run> {
  const done = await inproc(cwd, args, options.env)
  return { status: done.code, stdout: done.stdout, stderr: done.stderr }
}

test('with no ledger, a submodule keeps its own directory and a bare primary roots beside the bare repo', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sub-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'protocol.file.allow=always', ...args], { stdio: 'ignore' })
  const root = (cwd: string) => ds(cwd, ['root'])
  try {
    for (const name of ['lib', 'sup']) {
      mkdirSync(join(base, name))
      git(join(base, name), 'init', '-q')
      git(join(base, name), 'commit', '-q', '--allow-empty', '-m', 'init')
    }
    git(join(base, 'sup'), 'submodule', 'add', '-q', join(base, 'lib'), 's')
    mkdirSync(join(base, 'lib', 'pkg'))
    git(base, 'clone', '-q', '--bare', join(base, 'lib'), join(base, 'bare', 'repo.git'))
    git(join(base, 'bare', 'repo.git'), 'worktree', 'add', '-q', join(base, 'bare', 'feat'))
    const sub = await root(join(base, 'sup', 's'))
    const pkg = await root(join(base, 'lib', 'pkg'))
    const bare = await root(join(base, 'bare', 'feat'))
    assert.equal(sub.stdout, `${join(base, 'sup', 's')}\n`)
    assert.equal(pkg.stdout, `${join(base, 'lib')}\n`)
    assert.equal(bare.stdout, `${join(base, 'bare')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a linked worktree of a primary with a separate git dir roots at itself and ignores a ledger in the git dir', async () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sep-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'ignore' })
  try {
    mkdirSync(join(base, 'store'))
    git(base, 'init', '-q', `--separate-git-dir=${join(base, 'store', 'sep.git')}`, 'sep')
    git(join(base, 'sep'), 'commit', '-q', '--allow-empty', '-m', 'init')
    git(join(base, 'sep'), 'worktree', 'add', '-q', join(base, 'sep.feat'))
    mkdirSync(join(base, 'sep', '.scratchpad', 'dossier'), { recursive: true })
    mkdirSync(join(base, 'store', 'sep.git', '.scratchpad', 'dossier'), { recursive: true })
    const root = await ds(join(base, 'sep.feat'), ['root'])
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${join(base, 'sep.feat')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('outside git, with no ledger, the ledger root is the current directory', async () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ds-nogit-')))
  try {
    const root = await ds(dir, ['root'], { env: { GIT_CEILING_DIRECTORIES: tmpdir() } })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${dir}\n`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
