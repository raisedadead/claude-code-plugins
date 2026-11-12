import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ds } from './inproc.ts'

export const DS = join(import.meta.dirname, '..', 'cli', 'ds')
export const SLUG = '2026-10-09-wave'

export type Row = [id: string, state: string, who: string, needs?: string]

export type Run = { status: number; stdout: string; stderr: string }

export async function run(file: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<Run> {
  if (file === 'sh' && args[0] === DS) {
    const done = await ds(cwd ?? process.cwd(), args.slice(1), env)
    return { status: done.code, stdout: done.stdout, stderr: done.stderr }
  }
  const done = spawnSync(file, args, { cwd, encoding: 'utf8', env: env && { ...process.env, ...env } })
  if (done.error) throw done.error
  if (done.status === null) throw new Error(`${file} ${args.join(' ')} ended on ${done.signal}`)
  return { status: done.status, stdout: done.stdout, stderr: done.stderr }
}

export async function must(file: string, args: string[], cwd?: string, env?: Record<string, string>): Promise<string> {
  const done = await run(file, args, cwd, env)
  assert.equal(done.status, 0, `${file} ${args.join(' ')}: ${done.stderr}`)
  return done.stdout
}

export function ledger(rows: Row[], bugs = '', repos: string[] = []): string {
  const tasks = rows.map(([id, state, who, needs = '—']) => `| ${id} | ${state} | ${who} | task ${id} | ${needs} | ${state === 'x' ? 'abc1234' : '—'} | v |`)
  return [
    '# wave',
    '',
    '`2026-10-09` · `live` · `P1/1`',
    '',
    '## Goal',
    '',
    'g',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    ...tasks,
    '',
    '## Bugs',
    '',
    '| id | bug | root cause | invariant added | fix cite |',
    '|----|-----|------------|-----------------|----------|',
    ...(bugs ? [bugs] : []),
    '',
    '## Repos',
    '',
    '| repo | branch | ahead | tag | pushed | notes |',
    '|------|--------|-------|-----|--------|-------|',
    ...repos.map((path) => `| ${path} | main | 0 | — | yes | — |`),
    '',
    '## Status',
    '',
    '2026-10-09 09:00 ds:new — created slug=wave',
    '',
    '## Closeout',
    '',
    '_(empty — written by ds:close)_',
    '',
  ].join('\n')
}

export function contract(criterion = '`true`'): string {
  return `# wave\n\n| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | ${criterion} | exit 0 |\n`
}

export type Setup = { criterion?: string; bugs?: string; changelog?: boolean }

const templates = new Map<string, Promise<string>>()

export async function cleanTemplates(): Promise<void> {
  for (const made of await Promise.allSettled(templates.values())) {
    if (made.status === 'fulfilled') rmSync(made.value, { recursive: true, force: true })
  }
  templates.clear()
}

async function seed(options: Setup): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-close-seed-')))
  const git = (...args: string[]) => must('git', ['-C', root, ...args])
  try {
    await git('init', '-q', '-b', 'main')
    writeFileSync(join(root, '.gitignore'), '.scratchpad/\n')
    mkdirSync(join(root, '.dossier'))
    writeFileSync(join(root, '.dossier', `${SLUG}.md`), contract(options.criterion))
    if (options.changelog) writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n')
    await git('add', '.')
    await git('commit', '-q', '-m', 'init')
    return root
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
}

function template(options: Setup): Promise<string> {
  const key = JSON.stringify([options.criterion, options.changelog])
  const made = templates.get(key) ?? seed(options)
  templates.set(key, made)
  return made
}

async function repo(rows: Row[], options: Setup = {}): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-close-')))
  cpSync(await template(options), root, { recursive: true })
  mkdirSync(join(root, '.scratchpad', 'dossier', SLUG), { recursive: true })
  writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), ledger(rows, options.bugs))
  return root
}

export function close(root: string, ...args: string[]): Promise<Run> {
  return run('sh', [DS, 'close', SLUG, ...args], root)
}

export function live(root: string): string {
  return readFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), 'utf8')
}

export function archived(root: string): string {
  return readFileSync(join(root, '.scratchpad', 'dossier', '_archive', SLUG, 'DOSSIER.md'), 'utf8')
}

export async function lastSubject(root: string): Promise<string> {
  return (await must('git', ['-C', root, 'log', '-1', '--format=%s'])).trim()
}

export async function within(body: (root: string) => Promise<void>, rows: Row[], options: Setup = {}): Promise<void> {
  const root = await repo(rows, options)
  try {
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
