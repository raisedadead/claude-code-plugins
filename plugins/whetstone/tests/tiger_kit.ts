import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

export const CHECK = join(import.meta.dirname, '..', 'skills', 'tiger-style', 'scripts', 'tiger-check-cli.ts')
export const CLEAN = 0
export const BLOCK = 1
export const NAG = 2
export const USAGE = 64

export type Run = { status: number | null; stdout: string; stderr: string }

export function gitEnv(ambient: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return { ...ambient, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
}

export async function exec(file: string, args: string[], options: { cwd?: string; env: NodeJS.ProcessEnv; timeout?: number }): Promise<Run> {
  const done = spawnSync(file, args, { ...options, encoding: 'utf8' })
  return { status: done.status, stdout: done.stdout ?? '', stderr: done.stderr ?? '' }
}

export async function gitWith(ambient: NodeJS.ProcessEnv, repo: string, ...args: string[]): Promise<void> {
  const done = await exec('git', args, { cwd: repo, env: gitEnv(ambient) })
  if (done.status !== 0) {
    const detail = done.stderr.trim() || done.stdout.trim() || 'no output'
    throw new assert.AssertionError({ message: `git ${args.join(' ')} exited ${done.status}: ${detail}` })
  }
}

export function git(repo: string, ...args: string[]): Promise<void> {
  return gitWith(process.env, repo, ...args)
}

export async function init(repo: string, ambient: NodeJS.ProcessEnv = process.env): Promise<void> {
  await gitWith(ambient, repo, 'init', '-q', '-b', 'main')
  await gitWith(ambient, repo, 'config', 'user.email', 't@example.com')
  await gitWith(ambient, repo, 'config', 'user.name', 't')
}

export function commit(repo: string, message: string, ambient: NodeJS.ProcessEnv = process.env): Promise<void> {
  return gitWith(ambient, repo, 'commit', '-q', '-m', message)
}

export function write(repo: string, rel: string, body: string): void {
  const path = join(repo, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, body)
}

export function run(repo: string, overrides: Record<string, string> = {}, env?: NodeJS.ProcessEnv): Promise<Run> {
  const base = env ?? gitEnv()
  delete base.WHETSTONE_TIGER_COLS
  return exec(process.execPath, [CHECK, repo], { env: { ...base, ...overrides }, timeout: 20_000 })
}

export function line(width: number): string {
  return 'x'.repeat(width) + '\n'
}

export function verdict(result: Run): string {
  const lines = result.stdout.split('\n').filter((l) => l.startsWith('TIGER:'))
  return lines[lines.length - 1] ?? ''
}

export function out(result: Run): string {
  return result.stdout + result.stderr
}

export function crashed(result: Run): boolean {
  return /^\s+at /m.test(result.stderr)
}

export async function withRepo(body: (repo: string, tmp: string) => Promise<void>): Promise<void> {
  const tmp = mkdtempSync(join(tmpdir(), 'tiger-'))
  try {
    await body(tmp, tmp)
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export async function seeded(body: (repo: string) => Promise<void>): Promise<void> {
  await withRepo(async (repo) => {
    await init(repo)
    write(repo, 'seed.py', line(10))
    await git(repo, 'add', 'seed.py')
    await commit(repo, 'chore: seed')
    await body(repo)
  })
}
