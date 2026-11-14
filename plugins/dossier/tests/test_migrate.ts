import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { titleOf } from '../cli/migrate.ts'
import { shapeErrors } from '../engine/rows.ts'
import { ds, file, repo } from './kit.ts'

const TABLE = `# Open work

Rules:

- A done row names its commit.

| id | state | owner | item | source |
|----|-------|-------|------|--------|
| W1 | done | agent | Shipped thing | pr 1 |
| W2 | open | operator | Decide whether to delete the \`turbo\` Worker after wave 1 (see W1); keep it for now | grill §C |
| W3 | open 2026-11-12 | agent | Bump **vultr.cloud** when a release clears the warnings | notes.md:4 |
| O29 | open | operator | New dossier: Jev as the decision maker on risks | operator |
`

const BULLETS = `# Open work

- O1 [H] Collect team feedback on the docs branch \`feat/x\`, then push it
- O2 [A] Write the docs index page
- deferred — until O2: set \`deployment.site\` in the config
- deferred — until 2026-12-01: re-read the spend
- Cameras in Apple Home: PAUSED after backup
`

const LATER = `# Carried work

- vultr-lift/T75 · vminsert memory re-check: no OOMKilled in 7 d · A · due 2026-11-17
- suite-review-apply/T16 · Follow-up, Jev: a claim-check classifier · H
`

const INDEX = `# Dossiers

| date | slug | state | T | B | mtime | §Z |
|---|---|---|---|---|---|---|
| 2026-11-12 | routing | paused | 1/3 | 0 | 2026-11-12 22:06 | — |
| 2026-11-01 | finished | closed | 2/2 | 0 | 2026-11-02 10:00 | 2026-11-02 |
| 2026-10-01 | cam | closed | 2/2 | 0 | 2026-10-02 10:00 | 2026-10-02 |
`

const HOMELAB = `# cam

## §G — Goal

Watch the play area.

## §T — Task ledger

| id  | P   | state | task | cite | verify |
| --- | --- | ----- | ---- | ---- | ------ |
| T5  | 2   | .     | Firewall the phone; confirm zero egress | | |

## §X — Cross-repo state

| repo    | branch | ahead | tag | pushed | notes |
| ------- | ------ | ----- | --- | ------ | ----- |
| homelab | main   | 0     | —   | yes    |       |

## §S — Rolling status log

<!-- note -->

2026-06-01 10:00 ds:new — created slug=cam
`

const OLD = `# routing

\`2026-11-12\` · \`paused\`

## Goal

Every agent has a defined model.

## Tasks

| id | state | who | task | needs | cite | verify |
|----|-------|-----|------|-------|------|--------|
| T1 | x | A | Probe the host | — | a.ts:1 | \`true\` |
| T2 | . | A | Router shadow at \`prompt.submit\`: rule arms logged | T1 | plan §5 | \`bun test\` |
| T3 | ~ | H | Read the batch and say go | T2 | decision 8a | — |

## Repos

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|
| ~/r | feat/cc-1-routing | no-upstream | — | no | worktree |

## Status

<!-- note -->

2026-11-12 20:00 ds:new — created slug=routing

2026-11-13 09:30 ds:build T1 START
`

function seed(cwd: string, register: string): void {
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), register)
  file(join(cwd, '.scratchpad/dossier/LATER.md'), LATER)
  file(join(cwd, '.scratchpad/INDEX.md'), INDEX)
  file(join(cwd, '.scratchpad/dossier/2026-11-12-routing/DOSSIER.md'), OLD)
  file(join(cwd, '.scratchpad/dossier/2026-11-01-finished/DOSSIER.md'), '# finished\n\nold text\n')
  file(join(cwd, '.scratchpad/dossier/2026-11-02-cam/DOSSIER.md'), HOMELAB)
}

test('a dry run prints the plan and writes nothing', () => {
  const cwd = repo()
  seed(cwd, TABLE)
  const done = ds(cwd, 'migrate', '--dry-run')
  assert.equal(done.code, 0, done.err)
  assert.match(done.out, /^MIGRATE \(dry run\): 7 rows, O190 to O196$/m)
  assert.match(done.out, /^OPEN-WORK\.md: 5 rows; 1 closed rows left in the backup \(1 done\)/m)
  assert.match(done.out, /^ {2}- O29 wait H New dossier: Jev as the decision maker on risks$/m)
  assert.equal(file(join(cwd, '.scratchpad/OPEN-WORK.md')), TABLE)
  assert.ok(existsSync(join(cwd, '.scratchpad/INDEX.md')))
  assert.ok(!existsSync(join(process.env.DS_STATE_DIR ?? '', 'next-id')))
})

test('a table register, LATER.md, INDEX.md and old dossiers become O rows with backups', () => {
  const cwd = repo()
  seed(cwd, TABLE)
  const done = ds(cwd, 'migrate')
  assert.equal(done.code, 0, done.err)
  const register = file(join(cwd, '.scratchpad/OPEN-WORK.md'))
  assert.match(register, /^## Rows$/m)
  assert.match(register, /^- O190 wait H Decide whether to delete the turbo Worker after wave 1$/m)
  assert.match(register, /^- O191 next A Bump vultr\.cloud when a release clears the warnings$/m)
  assert.match(register, /^- O29 wait H New dossier: Jev as the decision maker on risks$/m)
  assert.match(register, /^- O192 later A vminsert memory re-check · until 2026-11-17$/m)
  assert.match(register, /^- O193 wait H Follow-up, Jev$/m)
  assert.doesNotMatch(register, /Shipped thing/)
  assert.match(
    register,
    /### O190\nWas W2 in OPEN-WORK.md before the migration.\n\nDecide whether to delete the `turbo` Worker after wave 1 \(see W1\); keep it for now\n\n- state: open\n- owner: operator\n- source: grill §C/,
  )
  assert.match(register, /### O29\nKept its ID in the migration\./)
  assert.equal(file(join(cwd, '.scratchpad/OPEN-WORK.pre-migrate.md')), TABLE)
  assert.equal(file(join(cwd, '.scratchpad/dossier/LATER.pre-migrate.md')), LATER)
  assert.equal(file(join(cwd, '.scratchpad/INDEX.pre-migrate.md')), INDEX)
  assert.ok(!existsSync(join(cwd, '.scratchpad/INDEX.md')))

  const dossier = file(join(cwd, '.scratchpad/dossier/2026-11-12-routing/DOSSIER.md'))
  assert.match(dossier, /^state: plan$/m)
  assert.match(dossier, /^branch: feat\/cc-1-routing$/m)
  assert.match(dossier, /^## Goal\n\n> Every agent has a defined model\.$/m)
  assert.match(dossier, /^- O195 next A Router shadow at prompt\.submit$/m)
  assert.match(dossier, /^- O196 now H Read the batch and say go$/m)
  assert.doesNotMatch(dossier, /Probe the host/)
  assert.match(
    dossier,
    /### O195\nWas T2 in the plan before the migration\.\n\nRouter shadow at `prompt\.submit`: rule arms logged\n\n- needs: T1\n- cite: plan §5\n- verify: `bun test`/,
  )
  assert.equal(file(join(cwd, '.scratchpad/dossier/2026-11-12-routing/DOSSIER.pre-migrate.md')), OLD)
  const worklog = file(join(cwd, '.scratchpad/dossier/2026-11-12-routing/worklog.md'))
  assert.match(worklog, /^- 2026-11-12 20:00 ds:new — created slug=routing$/m)
  assert.match(worklog, /^- 2026-11-13 09:30 ds:build T1 START$/m)
  assert.match(worklog, /migrate from the old plan; 2 rows$/m)

  assert.deepEqual(readdirSync(join(cwd, '.scratchpad/dossier/_archive')).sort(), ['.keep', '2026-11-01-finished'])
  const cam = file(join(cwd, '.scratchpad/dossier/2026-11-02-cam/DOSSIER.md'))
  assert.match(cam, /^## Goal\n\n> Watch the play area\.$/m)
  assert.match(cam, /^branch: cam$/m)
  assert.match(cam, /^- O194 next A Firewall the phone$/m)
  assert.match(file(join(cwd, '.scratchpad/dossier/2026-11-02-cam/worklog.md')), /^- 2026-06-01 10:00 ds:new — created slug=cam$/m)
  assert.equal(file(join(cwd, '.scratchpad/dossier/_archive/2026-11-01-finished/DOSSIER.md')), '# finished\n\nold text\n')
  assert.equal(file(join(process.env.DS_STATE_DIR ?? '', 'next-id')).trim(), '197')
  assert.match(file(join(cwd, '.scratchpad/LATER.md')), /O192 vminsert memory re-check · until 2026-11-17/)

  const triage = JSON.parse(ds(cwd, 'triage', '--json').out)
  assert.deepEqual(triage.shape, [])
  assert.deepEqual(
    triage.live.map((l: { slug: string; state: string }) => [l.slug, l.state]),
    [
      ['cam', 'plan'],
      ['routing', 'plan'],
    ],
  )
  assert.equal(ds(cwd, 'migrate').out, 'MIGRATE: nothing to do')
  assert.equal(ds(cwd, 'add', 'A new row', '--register').out.split(' ')[1], 'O197')
})

test('a backup or archive name that already exists refuses before any write', () => {
  const cwd = repo()
  seed(cwd, TABLE)
  file(join(cwd, '.scratchpad/dossier/_archive/2026-11-01-finished/DOSSIER.md'), 'other\n')
  const done = ds(cwd, 'migrate')
  assert.notEqual(done.code, 0)
  assert.match(done.err, /_archive\/2026-11-01-finished already exists/)
  assert.equal(file(join(cwd, '.scratchpad/OPEN-WORK.md')), TABLE)
  assert.equal(file(join(cwd, '.scratchpad/dossier/2026-11-12-routing/DOSSIER.md')), OLD)
  assert.ok(!existsSync(join(process.env.DS_STATE_DIR ?? '', 'next-id')))
})

test('a bullet register keeps a deferred line with a date as a later row, and waits the rest on the operator', () => {
  const cwd = repo()
  file(join(cwd, '.scratchpad/OPEN-WORK.md'), BULLETS)
  const done = ds(cwd, 'migrate')
  assert.equal(done.code, 0, done.err)
  const register = file(join(cwd, '.scratchpad/OPEN-WORK.md'))
  assert.match(register, /^- O190 wait H Collect team feedback on the docs branch feat\/x, then push it$/m)
  assert.match(register, /^- O191 next A Write the docs index page$/m)
  assert.match(register, /^- O192 wait A set deployment\.site in the config$/m)
  assert.match(register, /^- O193 later A re-read the spend · until 2026-12-01$/m)
  assert.match(register, /^- O194 wait H Cameras in Apple Home$/m)
  assert.match(register, /### O190\nWas O1 in OPEN-WORK.md before the migration\.\n\n- O1 \[H\] Collect/)
})

test('a title is short, plain and names no other ID', () => {
  for (const text of [
    'Temporary one-shot switch for O188: `~/.dotfiles/.claude/settings.local.json` turns off hooks',
    '(from netbird-overlay T3) (from backoffice T1) Inventory every **Tailscale** use, then [write](x.md) the notes for each of the forty-two hosts in the estate and the edge',
    'Aggressive rig simplification (Claude Code rig only: no skills). Then more.',
    '`a`',
  ]) {
    const title = titleOf(text)
    assert.deepEqual([title, shapeErrors({ id: 'O1', state: 'next', who: 'A', title, tail: '' })], [title, []])
  }
  assert.equal(titleOf('Temporary one-shot switch for O188: rest'), 'Rest')
  assert.equal(
    titleOf('(from netbird-overlay T3) Only if T10 is NetBird: prove self-hosted NetBird in a throwaway setup; record the version'),
    'Prove self-hosted NetBird in a throwaway setup',
  )
  assert.equal(titleOf('(from edge-egress-hardening T7) SES and Auth0 restrictions per T5'), 'SES and Auth0 restrictions')
  assert.equal(titleOf('Decide LOW findings (T3/T4/T5)'), 'Decide LOW findings')
  assert.equal(
    titleOf('Row 24: each Cloudflare record goes into `terraform-cloudflare` or is removed, per T11'),
    'Row 24: each Cloudflare record goes into terraform-cloudflare or is removed',
  )
  assert.equal(
    titleOf('Aggressive rig simplification (Claude Code rig only: no skills). Then more.'),
    'Aggressive rig simplification (Claude Code rig only: no skills)',
  )
  assert.match(titleOf('(from netbird-overlay T3) Inventory every Tailscale use'), /^Inventory every Tailscale use$/)
})
