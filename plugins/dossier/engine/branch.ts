import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, gitTry, lines, Refusal } from './sh.ts'

export type Commit = { sha: string; subject: string; body: string }
export type Review = {
  time: string
  agent?: string
  branch: string
  base: string
  head: string
  tree: string
  patch: string
  verdict: string
  findings: string
}

export const REVIEWER = 'reviewer'

export const reviewedBy = (review: Review, agent: string): boolean => (review.agent ?? REVIEWER) === agent

const FIXUP = /^fixup! /

export function commitsIn(cwd: string, range: string): Commit[] {
  const out = git(cwd, 'log', '--reverse', '-z', '--format=%H%x1f%s%x1f%b', range)
  return out
    .split('\0')
    .filter(Boolean)
    .map((record) => {
      const [sha = '', subject = '', body = ''] = record.replace(/^\n/, '').split('\x1f')
      return { sha, subject, body: body.trim() }
    })
}

export function fixupTarget(subject: string): string | undefined {
  return FIXUP.test(subject) ? subject.replace(FIXUP, '') : undefined
}

export function mergeBase(cwd: string, base: string): string {
  const done = gitTry(cwd, 'merge-base', base, 'HEAD')
  if (done.code !== 0) throw new Refusal(`no merge base between ${base} and HEAD`)
  return done.out.trim()
}

export function changedPaths(cwd: string, sha: string): string[] {
  return lines(git(cwd, 'diff-tree', '--no-commit-id', '--name-only', '-r', '--root', sha))
}

export function clean(cwd: string): boolean {
  return git(cwd, 'status', '--porcelain', '--untracked-files=no') === ''
}

export function tree(cwd: string, rev = 'HEAD'): string {
  return git(cwd, 'rev-parse', `${rev}^{tree}`)
}

export function onRemote(cwd: string, sha: string): boolean {
  return git(cwd, 'branch', '-r', '--contains', sha) !== ''
}

export function conflicted(cwd: string): string[] {
  return lines(gitTry(cwd, 'diff', '--name-only', '--diff-filter=U').out)
}

export function worktreeOf(cwd: string, branch: string): string | undefined {
  let path: string | undefined
  for (const line of git(cwd, 'worktree', 'list', '--porcelain').split('\n')) {
    if (line.startsWith('worktree ')) path = line.slice(9)
    if (line === `branch refs/heads/${branch}`) return path
  }
  return undefined
}

export function defaultBase(cwd: string): string {
  const done = gitTry(cwd, 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD')
  return done.code === 0 ? done.out.trim().replace(/^origin\//, '') : 'main'
}

export function globMatch(pattern: string, path: string): boolean {
  if (pattern.endsWith('/')) return path.startsWith(pattern)
  let source = ''
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] ?? ''
    if (char === '*' && pattern[i + 1] === '*') {
      source += pattern[i + 2] === '/' ? '(?:.*/)?' : '.*'
      i += pattern[i + 2] === '/' ? 2 : 1
    } else if (char === '*') source += '[^/]*'
    else if (char === '?') source += '[^/]'
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${source}$`).test(path) || path.startsWith(`${pattern}/`)
}

export function literalPrefix(pattern: string): string {
  const at = pattern.search(/[*?]/)
  return at < 0 ? pattern : pattern.slice(0, at)
}

export function overlaps(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => literalPrefix(x).startsWith(literalPrefix(y)) || literalPrefix(y).startsWith(literalPrefix(x))))
}

export function reviewsFile(cwd: string): string {
  return join(git(cwd, 'rev-parse', '--path-format=absolute', '--git-common-dir'), 'reviews.jsonl')
}

export function reviews(cwd: string): Review[] {
  const file = reviewsFile(cwd)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Review]
      } catch {
        return []
      }
    })
}
