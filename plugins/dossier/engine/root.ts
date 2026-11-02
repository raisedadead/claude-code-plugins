export const GIT_DIRS = ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']
export const WORKTREES = ['worktree', 'list', '--porcelain']

const ABSOLUTE = /^(\/|[A-Za-z]:\/)/

function dirsOf(gitDirs: string | undefined): { gitDir: string; commonDir: string } | undefined {
  const [gitDir = '', commonDir = ''] = (gitDirs ?? '').trim().split('\n')
  return ABSOLUTE.test(gitDir) && ABSOLUTE.test(commonDir) ? { gitDir, commonDir } : undefined
}

export function firstWorktree(worktrees: string | undefined, gitDirs: string | undefined): string | undefined {
  const [first = ''] = (worktrees ?? '').split('\n\n')
  const path = /^bare$/m.test(first) ? undefined : /^worktree (.+)$/m.exec(first)?.[1]
  const commonDir = dirsOf(gitDirs)?.commonDir
  const insideGitDir = Boolean(path && commonDir && (path === commonDir || path.startsWith(`${commonDir}/`)))
  return insideGitDir ? undefined : path
}

export function linkedPrimary(gitDirs: string | undefined, worktrees: string | undefined): string | undefined {
  const dirs = dirsOf(gitDirs)
  if (!dirs || dirs.gitDir === dirs.commonDir) return undefined
  const [first = ''] = (worktrees ?? '').split('\n\n')
  if (/^bare$/m.test(first)) return dirs.commonDir.replace(/\/[^/]+\/?$/, '') || '/'
  return firstWorktree(worktrees, gitDirs)
}
