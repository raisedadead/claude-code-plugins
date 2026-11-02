import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

interface Fixture {
  dir: string
  sp: string
  dd: string
  arc: string
}

function makeDoss(dd: string, slug: string, token: string, zbody: string): void {
  const dir = join(dd, slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'DOSSIER.md'),
    `\`2026-06-01\` · \`${token}\` · \`P1/1\`\n\n## §T — Task ledger\n\n| T1 | P1 | x | thing | [a1] | — |\n\n## §S — Rolling status log\n\n2026-06-01 10:00 ds:close — START successor=— complete=true abandon=false\n\n## §Z — Closeout\n\n${zbody}\n`,
  )
}

function hdrOf(file: string): string {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const match = /^`[^`]*` · `([^`]*)`/.exec(line)
    if (match) return (match[1] ?? '').trim()
  }
  return ''
}

function isFile(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isFile() ?? false
}

function isDir(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false })?.isDirectory() ?? false
}

function exists(path: string): boolean {
  return statSync(path, { throwIfNoEntry: false }) !== undefined
}

async function fixture(): Promise<Fixture> {
  const { dir, clean } = tempRoot('dossier-reconcile-')
  cleanups.push(clean)
  const sp = join(dir, '.scratchpad')
  const dd = join(sp, 'dossier')
  makeDoss(dd, '2026-06-05-zombie', 'done', 'complete: true')
  makeDoss(dd, '2026-06-04-crashflip', 'live', 'successor: next-phase')
  makeDoss(dd, '2026-06-03-partial', 'done', '_(empty)_')
  makeDoss(dd, '2026-06-02-alive', 'live', '_(empty)_')
  makeDoss(dd, '2026-06-02-prose', 'live', 'draft: if we stop early the work is carried into the successor: the age-identity exemption stays unbuilt.')
  makeDoss(dd, '2026-06-01-locked', 'done', 'complete: true')
  writeFileSync(join(dd, '2026-06-01-locked', '.ds-lock'), `{"pid": ${process.pid}, "started": "2026-06-01T10:00:00Z", "skill": "ds:close"}`)
  const done = await ds(dir, ['reconcile', sp])
  assert.equal(done.code, 0, done.stderr)
  return { dir, sp, dd, arc: join(dd, '_archive') }
}

test('a closed done zombie is auto-archived, leaves its live location and gains a breadcrumb', async () => {
  const { dd, arc } = await fixture()
  assert.ok(isFile(join(arc, '2026-06-05-zombie', 'DOSSIER.md')), '§Z-closed done zombie must be auto-archived')
  assert.ok(!exists(join(dd, '2026-06-05-zombie')), 'auto-archived zombie must leave live location')
  assert.ok(readFileSync(join(arc, '2026-06-05-zombie', 'DOSSIER.md'), 'utf8').includes('ds:reconcile'), 'auto-archive must leave a §S breadcrumb')
})

test('a closed live-header dossier is healed to done before archiving', async () => {
  const { arc } = await fixture()
  assert.ok(isFile(join(arc, '2026-06-04-crashflip', 'DOSSIER.md')), '§Z-closed live-header (crash between §Z and flip) must be healed')
  assert.equal(hdrOf(join(arc, '2026-06-04-crashflip', 'DOSSIER.md')), 'done', 'heal must flip header to done before archiving')
})

test('detect-only, concordant, locked and prose-only dossiers stay where they are', async () => {
  const { dd } = await fixture()
  assert.ok(isDir(join(dd, '2026-06-03-partial')), 'done-header with empty §Z is detect-only, must NOT be auto-moved')
  assert.ok(isDir(join(dd, '2026-06-02-alive')), 'concordant live dossier must be untouched')
  assert.ok(isDir(join(dd, '2026-06-01-locked')), 'locked (active op) dossier must not be reconciled')
  assert.ok(isDir(join(dd, '2026-06-02-prose')), "§Z prose that merely contains 'successor: <word>' mid-sentence must NOT archive a live wave")
  assert.equal(hdrOf(join(dd, '2026-06-02-prose', 'DOSSIER.md')), 'live', 'a prose-only §Z must leave the header live')
})

test('a second reconcile is idempotent', async () => {
  const { dir, sp, arc } = await fixture()
  const again = await ds(dir, ['reconcile', sp])
  assert.equal(again.code, 0, again.stderr)
  assert.ok(isFile(join(arc, '2026-06-05-zombie', 'DOSSIER.md')), 'second reconcile must be idempotent')
})

test('an archived dir with a non-done header is healed to done', async () => {
  const { dir, sp, arc } = await fixture()
  const inverse = join(arc, '2026-05-01-inverse')
  mkdirSync(inverse, { recursive: true })
  writeFileSync(join(inverse, 'DOSSIER.md'), '`2026-05-01` · `live` · `P1/1`\n\n## §Z — Closeout\n\ncomplete: true\n')
  const done = await ds(dir, ['reconcile', sp])
  assert.equal(done.code, 0, done.stderr)
  assert.equal(hdrOf(join(inverse, 'DOSSIER.md')), 'done', 'archived dir with a non-done header must be healed to done (inverse drift)')
})
