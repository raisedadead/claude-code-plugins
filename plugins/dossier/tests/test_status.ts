import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { ds, file, planned, repo, sh } from './kit.ts'

function snapshot(dir: string): string {
  const out: string[] = []
  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else out.push(`${path} ${statSync(path).mtimeMs} ${readFileSync(path, 'utf8')}`)
    }
  }
  walk(dir)
  return out.join('\n')
}

test('status prints nothing when no dossier is live', () => {
  const cwd = repo()
  assert.deepEqual(ds(cwd, 'status'), { code: 0, out: '', err: '' })
})

test('status prints the state, the count of done rows, the next agent row and the rows that wait on the operator', () => {
  const cwd = repo()
  const path = planned(cwd)
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/3 · next O1 · waits on you: O3')
  file(path, file(path).replace('- O1 next A', '- O1 done A'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 33% · 1/3 · next O2 · waits on you: O3')
  file(path, file(path).replace('- O3 wait H', '- O3 next H'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 33% · 1/3 · next O2 · waits on you: O3', 'an operator row that is next waits on you')
  file(path, file(path).replace('- O1 done A', '- O1 next A').replace('- O2 next A', '- O2 now A'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/3 · next O2 · waits on you: O3', 'a row in now comes before an earlier row in next')
  file(path, file(path).replace('- O1 next A', '- O1 later A'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/2 · next O2 · waits on you: O3', 'a later row is not counted')
  file(path, file(path).replace('- O1 later A', '- O1 done A').replace('- O2 now A', '- O2 next A').replace('- O3 next H', '- O3 wait H'))
  file(path, file(path).replace('- O2 next A', '- O2 drop A').replace('- O3 wait H', '- O3 done H'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 100% · 2/2')
  file(path, file(path).replace(/^- O\d+ .*\n/gm, ''))
  assert.equal(ds(cwd, 'status').out, 'demo plan · no rows')
})

test('status puts the dossier of the current branch alone, and lists each live dossier on any other branch', () => {
  const cwd = repo()
  const path = planned(cwd)
  ds(cwd, 'new', 'other')
  assert.equal(ds(cwd, 'status').out, 'demo plan 0/3 · you 1\nother plan · no rows', 'several live dossiers get the short form')
  file(path, file(path).replace('- O3 wait H', '- O3 done H'))
  assert.equal(ds(cwd, 'status').out, 'demo plan 1/3\nother plan · no rows')
  file(path, file(path).replace('- O3 done H', '- O3 wait H'))
  sh(cwd, 'git checkout -q -b demo')
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/3 · next O1 · waits on you: O3')
  sh(cwd, 'git checkout -q -b demo-lane-2')
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/3 · next O1 · waits on you: O3', 'a lane branch')
  file(path, file(path).replace('branch: demo', 'branch: feat/cc-abc123-demo'))
  assert.match(ds(cwd, 'status').out, /\nother plan/, 'a branch that names no dossier')
  sh(cwd, 'git checkout -q -b feat/demo')
  assert.equal(ds(cwd, 'status').out, 'demo plan 0% · 0/3 · next O1 · waits on you: O3', 'the name that a ship gave the branch')
})

test('status writes no file, also for a branch that a ship renamed', () => {
  const cwd = repo()
  const path = planned(cwd)
  file(path, file(path).replace('branch: demo', 'branch: feat/cc-abc123-demo'))
  sh(cwd, 'git branch feat/cc-abc123-demo && git branch -m feat/cc-abc123-demo feat/demo')
  const scratch = join(dirname(dirname(dirname(path))))
  const before = [snapshot(scratch), snapshot(process.env.DS_STATE_DIR ?? ''), sh(cwd, 'git status --porcelain --ignored')]
  assert.equal(ds(cwd, 'status').code, 0)
  assert.deepEqual([snapshot(scratch), snapshot(process.env.DS_STATE_DIR ?? ''), sh(cwd, 'git status --porcelain --ignored')], before)
  assert.match(ds(cwd, 'path').out, /demo$/)
  assert.notDeepEqual(snapshot(scratch), before[0], 'ds path follows the rename, so the fixture does reach the write')
})
