import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function git(dir: string, args: string[]): void {
  execFileSync('git', ['-C', dir, ...args], { stdio: 'ignore' })
}

function repo(): string {
  const { dir, clean } = tempRoot('dossier-fakeimpl-')
  cleanups.push(clean)
  git(dir, ['init', '-q'])
  git(dir, ['config', 'user.email', 't@example.com'])
  git(dir, ['config', 'user.name', 'tester'])
  git(dir, ['config', 'core.excludesFile', '/dev/null'])
  writeFileSync(join(dir, 'a.txt'), 'seed\n')
  git(dir, ['add', '-A'])
  git(dir, ['commit', '-qm', 'seed'])
  return dir
}

function dirty(dir: string): void {
  appendFileSync(join(dir, 'a.txt'), 'dirty\n')
}

async function blocks(cwd: string, command: string): Promise<boolean> {
  const { code, stdout, stderr } = await ds(cwd, ['fakeimpl'], { DOSSIER_FAKEIMPL_CMD: command }, '{}')
  assert.equal(code, 0, stderr)
  return stdout.includes('"decision":"block"')
}

test('an unset command does not block', async () => {
  const dir = repo()
  dirty(dir)
  assert.ok(!(await blocks(dir, '')), 'disabled (unset cmd) must not block')
})

test('a failing command on a dirty tree blocks', async () => {
  const dir = repo()
  dirty(dir)
  assert.ok(await blocks(dir, 'false'), 'failing cmd on a dirty tree must block')
})

test('a passing command does not block', async () => {
  const dir = repo()
  dirty(dir)
  assert.ok(!(await blocks(dir, 'true')), 'passing cmd must not block')
})

test('a clean tree does not run the command', async () => {
  const dir = repo()
  assert.ok(!(await blocks(dir, 'false')), 'clean tree must not run the cmd')
})

test('the suite scratchpad writes do not arm the gate', async () => {
  const dir = repo()
  mkdirSync(join(dir, '.scratchpad', 'dossier'), { recursive: true })
  writeFileSync(join(dir, '.scratchpad', 'dossier', 'DOSSIER.md'), 'ledger\n')
  assert.ok(!(await blocks(dir, 'false')), "the suite's own .scratchpad writes must not arm the gate")
})

test('a nested scratchpad does not arm the gate', async () => {
  const dir = repo()
  mkdirSync(join(dir, 'apps', 'web', '.scratchpad', 'dossier'), { recursive: true })
  writeFileSync(join(dir, 'apps', 'web', '.scratchpad', 'dossier', 'DOSSIER.md'), 'ledger\n')
  assert.ok(!(await blocks(dir, 'false')), 'a nested .scratchpad must not arm the gate either')
})

test('a scratchpad above the session cwd does not arm the gate', async () => {
  const dir = repo()
  const web = join(dir, 'apps', 'web')
  mkdirSync(join(web, '.scratchpad', 'dossier'), { recursive: true })
  writeFileSync(join(web, '.scratchpad', 'dossier', 'DOSSIER.md'), 'ledger\n')
  assert.ok(!(await blocks(web, 'false')), 'a .scratchpad above the session cwd must not arm the gate')
})

test('an untracked-only change still arms the gate', async () => {
  const dir = repo()
  writeFileSync(join(dir, 'brand_new.py'), 'def f():\n    pass\n')
  assert.ok(await blocks(dir, 'false'), 'an untracked-only change is still a dirty tree — a new file is where a fake implementation lives')
})
