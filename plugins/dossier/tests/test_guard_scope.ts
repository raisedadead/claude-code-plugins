import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const ISOLATED = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const EVAL = { id: 'V1', pattern: 'eval\\(', message: 'no eval' }

let base = ''
let project = ''
let clean = (): void => {}

function git(dir: string, ...args: string[]): void {
  execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { env: { ...process.env, ...ISOLATED }, stdio: 'ignore' })
}

function repo(name: string): string {
  const dir = join(base, name)
  mkdirSync(join(dir, 'src'), { recursive: true })
  git(dir, 'init', '-q')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
  return dir
}

beforeEach(() => {
  const made = tempRoot('ds-guard-scope-')
  base = made.dir
  clean = made.clean
  project = repo('proj')
  mkdirSync(join(project, '.scratchpad', 'dossier'), { recursive: true })
})

afterEach(() => clean())

function registry(paths?: string[]): void {
  const entry = paths ? { ...EVAL, paths } : EVAL
  writeFileSync(join(project, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify([entry]))
}

async function check(file: string, env: Record<string, string> = {}): Promise<number> {
  const payload = JSON.stringify({ file_path: file, chunks: ['x = eval(y)'] })
  return (await ds(base, ['invariant-check', project], { ...ISOLATED, ...env }, payload)).code
}

test('a GIT_DIR in the environment does not pull an unrelated repo into scope', async () => {
  registry(['*'])
  const other = repo('other')
  assert.equal(await check(join(other, 'src', 'app.py'), { GIT_DIR: join(project, '.git') }), 0)
})

test('a path that reaches the root through a symlink and a .. segment is still checked', async () => {
  registry(['src/*.py'])
  const out = join(base, 'out')
  mkdirSync(out)
  symlinkSync(join(project, 'src'), join(out, 'link'))
  assert.equal(await check(`${out}/link/../src/app.py`), 1)
})

test('a root-relative glob does not reach a file in an unrelated repo', async () => {
  registry(['src/*.py'])
  const other = repo('other')
  assert.equal(await check(join(other, 'src', 'app.py')), 0)
})

test('an unscoped guard does not reach a file in an unrelated repo', async () => {
  registry()
  const other = repo('other')
  assert.equal(await check(join(other, 'src', 'app.py')), 0)
})

test('a star glob does not reach a file in an unrelated repo', async () => {
  registry(['*'])
  const other = repo('other')
  assert.equal(await check(join(other, 'src', 'app.py')), 0)
})

test('the guard still blocks the same edit inside the root and in a linked worktree', async () => {
  registry(['src/*.py'])
  const tree = join(base, 'tree')
  git(project, 'worktree', 'add', '-q', tree)
  assert.equal(await check(join(project, 'src', 'app.py')), 1)
  assert.equal(await check(join(tree, 'src', 'app.py')), 1)
})

test('an unscoped guard still blocks the same edit inside the root', async () => {
  registry()
  assert.equal(await check(join(project, 'src', 'app.py')), 1)
})
