export const GIT_DIRS = ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir']

export function linkedPrimary(gitDirs: string | undefined): string | undefined {
  const [gitDir, commonDir] = (gitDirs ?? '').trim().split('\n')
  if (!gitDir || !commonDir || gitDir === commonDir) return undefined
  return commonDir.replace(/\/[^/]+\/?$/, '') || '/'
}
