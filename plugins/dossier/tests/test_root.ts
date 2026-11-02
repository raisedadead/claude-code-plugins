import assert from 'node:assert/strict'
import { test } from 'vitest'
import { firstWorktree, linkedPrimary } from '../engine/root.ts'

const PORCELAIN = 'worktree /r\nHEAD abc\nbranch refs/heads/main\n\nworktree /r.feat\nHEAD def\n'

test('a linked worktree takes the first worktree as its primary', () => {
  assert.equal(linkedPrimary('/r/.git/worktrees/r.feat\n/r/.git\n', PORCELAIN), '/r')
})

test('a primary with a separate git dir is listed as its git dir, so it is not found', () => {
  const gitDirs = '/store/sep.git/worktrees/sep.feat\n/store/sep.git\n'
  const porcelain = 'worktree /store/sep.git\nHEAD abc\n\nworktree /sep.feat\nHEAD def\n'
  assert.equal(linkedPrimary(gitDirs, porcelain), undefined)
  assert.equal(firstWorktree(porcelain, gitDirs), undefined)
})

test('a bare primary roots at the folder that holds the bare repo', () => {
  const porcelain = 'worktree /b/repo.git\nbare\n\nworktree /b/feat\nHEAD def\n'
  assert.equal(linkedPrimary('/b/repo.git/worktrees/feat\n/b/repo.git\n', porcelain), '/b')
  assert.equal(firstWorktree(porcelain, undefined), undefined)
})

test('a checkout that is not a linked worktree has no primary', () => {
  assert.equal(linkedPrimary('/r/.git\n/r/.git\n', PORCELAIN), undefined)
})

test('git older than 2.31 echoes the unknown flag, which is not read as a git dir', () => {
  assert.equal(linkedPrimary('--path-format=absolute\n/r/.git/worktrees/r.feat\n/r/.git\n', PORCELAIN), undefined)
  assert.equal(linkedPrimary('--path-format=absolute\n.git\n.git\n', PORCELAIN), undefined)
  assert.equal(firstWorktree(PORCELAIN, '--path-format=absolute\n.git\n.git\n'), '/r')
})

test('a first worktree inside the git dir, as a submodule worktree reports it, is not a primary', () => {
  const porcelain = 'worktree /sup/.git/modules/s\nHEAD abc\n\nworktree /s.feat\nHEAD def\n'
  const gitDirs = '/sup/.git/modules/s/worktrees/s.feat\n/sup/.git/modules/s\n'
  assert.equal(linkedPrimary(gitDirs, porcelain), undefined)
  assert.equal(firstWorktree(porcelain, gitDirs), undefined)
})
