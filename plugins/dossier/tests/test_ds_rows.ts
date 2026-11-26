import assert from 'node:assert/strict'
import { appendFileSync, chmodSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'vitest'
import { ds, file, planned, repo, sh } from './kit.ts'

type Listed = {
  slug: string
  state: string
  done: number
  rows: number
  pinned: boolean
  needs: string[]
  hold?: unknown
  repo?: string
  next?: string
  items: { id: string; note?: string }[]
}
const listed = (cwd: string, ...argv: string[]): Listed[] => JSON.parse(ds(cwd, 'rows', '--json', ...argv).out).dossiers

test('ds rows: each live dossier with its counts, its operator rows and its open rows in plan order', () => {
  const cwd = repo()
  planned(cwd)
  ds(cwd, 'set', 'O2', 'done', 'built')
  assert.deepEqual(listed(cwd), [
    {
      slug: 'demo',
      state: 'plan',
      done: 1,
      rows: 3,
      pinned: false,
      next: 'O1 Add the b module',
      needs: ['O3'],
      items: [
        { id: 'O1', state: 'next', who: 'A', title: 'Add the b module', tail: '', note: 'Keep it short.' },
        { id: 'O3', state: 'wait', who: 'H', title: 'Approve the PR', tail: '' },
      ],
    },
  ])
})

test('ds rows: --session pins only the dossiers that session used, and the verb links no session', () => {
  const cwd = repo()
  process.env.CLAUDE_CODE_SESSION_ID = 's-one'
  const path = planned(cwd)
  delete process.env.CLAUDE_CODE_SESSION_ID
  const other = ds(cwd, 'new', 'other').out
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => [d.slug, d.pinned]),
    [
      ['demo', true],
      ['other', false],
    ],
  )
  assert.deepEqual(
    listed(cwd).map((d) => d.pinned),
    [false, false],
  )
  process.env.CLAUDE_CODE_SESSION_ID = 's-two'
  listed(cwd, '--session', 's-two')
  delete process.env.CLAUDE_CODE_SESSION_ID
  assert.equal(existsSync(join(dirname(other), '.sessions')), false)
  assert.deepEqual(
    listed(cwd, '--session', 's-two').map((d) => d.pinned),
    [false, false],
  )
  assert.ok(existsSync(join(dirname(path), '.sessions')))
})

test('ds rows: --session adds the live dossiers that session used in other repos, each with its repo, once', () => {
  const other = repo()
  planned(other)
  const cwd = repo()
  const state = process.env.DS_STATE_DIR
  process.env.CLAUDE_CODE_SESSION_ID = 's-one'
  ds(other, 'lint')
  ds(cwd, 'new', 'mine')
  ds(cwd, 'lint')
  delete process.env.CLAUDE_CODE_SESSION_ID
  const root = sh(other, 'git rev-parse --show-toplevel')
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => [d.slug, d.pinned, d.repo]),
    [
      ['mine', true, undefined],
      ['demo', true, root],
    ],
  )
  assert.equal(
    file(join(state ?? '', 'sessions', 's-one'))
      .split('\n')
      .filter(Boolean).length,
    2,
    'one line per root',
  )
  assert.deepEqual(
    listed(cwd, '--session', 's-two').map((d) => d.slug),
    ['mine'],
  )
  assert.deepEqual(
    listed(other, '--session', 's-one').map((d) => [d.slug, d.repo]),
    [
      ['demo', undefined],
      ['mine', sh(cwd, 'git rev-parse --show-toplevel')],
    ],
  )
  ds(other, 'new', 'unused')
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => d.slug),
    ['mine', 'demo'],
    'a dossier of the other repo that the session never used',
  )
  appendFileSync(join(state ?? '', 'sessions', 's-one'), `${root}\n`)
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => d.slug),
    ['mine', 'demo'],
    'a root written twice',
  )
  const demo = join(root, '.scratchpad/dossier', sh(other, 'ls .scratchpad/dossier | grep demo'), 'DOSSIER.md')
  chmodSync(demo, 0)
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => d.slug),
    ['mine'],
    'an unreadable dossier of the other repo leaves out that repo, not the session repo',
  )
  chmodSync(demo, 0o644)
  file(demo, file(demo).replace('state: plan', 'state: done'))
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => d.slug),
    ['mine'],
    'a closed dossier of the other repo',
  )
  rmSync(root, { recursive: true, force: true })
  assert.deepEqual(
    listed(cwd, '--session', 's-one').map((d) => d.slug),
    ['mine'],
  )
  assert.deepEqual(
    listed(cwd, '--session', '../s-one').map((d) => d.slug),
    ['mine'],
  )
})

test('ds rows: a held dossier carries its hold and needs nothing', () => {
  const cwd = repo()
  planned(cwd)
  ds(cwd, 'set', 'O100', 'wait', 'paused: after the release', '--who', 'H')
  const [demo] = listed(cwd)
  assert.deepEqual(demo?.hold, { id: 'O100', state: 'wait', tail: 'paused: after the release', after: false })
  assert.deepEqual(demo?.needs, [])
  assert.equal(demo?.next, undefined)
  assert.equal(ds(cwd, 'rows').code, 0)
  ds(cwd, 'set', 'O100', 'wait', 'after O1')
  assert.deepEqual(listed(cwd)[0]?.hold, { id: 'O100', state: 'wait', tail: 'after O1', after: true })
})
