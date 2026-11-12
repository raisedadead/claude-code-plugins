import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export function git(repo: string, ...args: string[]): string {
  const done = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  if (done.status !== 0) throw new Error(`git ${args.join(' ')}: ${done.stderr}`)
  return done.stdout
}

export function emptyRepo(dir: string): void {
  git(dir, 'init', '-q', '-b', 'main')
}

export interface Template {
  copy: (prefix?: string) => string
  clean: () => void
}

export function template(build: (dir: string) => void): Template {
  let made: string | undefined
  const copies: string[] = []
  return {
    copy: (prefix = 'ds-repo-') => {
      if (made === undefined) {
        made = realpathSync(mkdtempSync(join(tmpdir(), 'ds-template-')))
        build(made)
      }
      const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
      cpSync(made, dir, { recursive: true })
      copies.push(dir)
      return dir
    },
    clean: () => {
      for (const dir of [...copies, ...(made === undefined ? [] : [made])]) rmSync(dir, { recursive: true, force: true })
      copies.length = 0
      made = undefined
    },
  }
}
