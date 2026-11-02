import assert from 'node:assert/strict'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const LIVE = '`2026-06-05` · `live` · `P1/1`\n\n## §T\n\n| T1 | P1 | . | do thing | — | — |\n\n## §S\n\nstarted\n'

let ws = ''
let clean = (): void => {}
beforeEach(() => {
  ;({ dir: ws, clean } = tempRoot('ds-session-start-'))
  delete process.env.DOSSIER_SESSION_TITLE
  delete process.env.DOSSIER_LIVE_NUDGE
})
afterEach(() => clean())

function ledger(slug: string, text = LIVE): string {
  const dir = join(ws, '.scratchpad', 'dossier', slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), text)
  return join(dir, 'DOSSIER.md')
}

type Hook = { code: number; raw: Record<string, unknown>; title: string; sys: string; ctx: string; hasContext: boolean }

async function hook(
  source: string,
  title: string | undefined = '',
  env: Record<string, string> = { DOSSIER_SESSION_TITLE: '1' },
  input?: string,
): Promise<Hook> {
  const payload = input ?? JSON.stringify({ hook_event_name: 'SessionStart', source, ...(title === undefined ? {} : { session_title: title }) })
  const done = await ds(ws, ['session-start'], env, payload)
  const raw = JSON.parse(done.stdout) as Record<string, unknown>
  const specific = (raw.hookSpecificOutput ?? {}) as Record<string, unknown>
  return {
    code: done.code,
    raw,
    title: String(specific.sessionTitle ?? ''),
    sys: String(raw.systemMessage ?? ''),
    ctx: String(specific.additionalContext ?? ''),
    hasContext: 'additionalContext' in specific,
  }
}

test('the session title is opt-in, and the opt-out keeps the context', async () => {
  ledger('2026-06-05-foo')
  const unset = await hook('startup', '', {})
  assert.equal(unset.title, '')
  assert.ok(unset.hasContext)
  const zero = await hook('startup', '', { DOSSIER_SESSION_TITLE: '0' })
  assert.equal(zero.title, '')
  assert.ok(zero.hasContext)
})

test('startup, resume and fork with an empty title take the live slug as the title', async () => {
  ledger('2026-06-05-foo')
  const startup = await hook('startup')
  assert.equal(startup.code, 0)
  assert.equal(startup.title, '2026-06-05-foo')
  assert.ok(startup.hasContext)
  assert.equal((await hook('resume')).title, '2026-06-05-foo')
  assert.equal((await hook('fork')).title, '2026-06-05-foo')
})

test('a title the operator set is never replaced, and clear and compact set none', async () => {
  ledger('2026-06-05-foo')
  assert.equal((await hook('fork', 'user-set')).title, '')
  assert.equal((await hook('resume', 'user-set')).title, '')
  assert.equal((await hook('clear')).title, '')
  assert.equal((await hook('compact')).title, '')
})

test('malformed stdin fails open with valid JSON and no title', async () => {
  ledger('2026-06-05-foo')
  const done = await hook('', '', undefined, 'not json at all')
  assert.equal(done.code, 0)
  assert.equal(done.title, '')
})

test('a sealed wave with an open close is drift: named, not counted live, with a resume hint', async () => {
  ledger('2026-06-05-foo')
  ledger(
    '2026-06-04-zombie',
    '`2026-06-04` · `sealed` · `P1/1`\n\n## §T — Task ledger\n\n| T1 | P1 | x | done thing | [a1] | — |\n\n## §S — Rolling status log\n\n2026-06-04 09:00 ds:close — START successor=— complete=true abandon=false\n\n## §Z — Closeout\n\n_(empty)_\n',
  )
  const done = await hook('startup')
  assert.equal(done.code, 0)
  assert.equal(done.title, '2026-06-05-foo')
  assert.match(done.sys, /drift/i)
  assert.match(done.sys, /zombie/)
  assert.doesNotMatch(done.sys, /[0-9]+ live/)
  assert.match(done.ctx, /resume/i)
  assert.match(done.ctx, /ds:close/)
})

test('an unpaired build START is a resume; a START with its DONE is not', async () => {
  const file = ledger('2026-06-05-foo')
  appendFileSync(file, '\n2026-06-05 10:00 ds:build T2 START\n\n2026-06-05 10:05 ds:build T3 START\n\n2026-06-05 10:06 ds:build T3 DONE\n')
  const done = await hook('startup')
  assert.match(done.ctx, /T2/)
  assert.doesNotMatch(done.ctx, /resume[^A-Za-z]*needed.*T3/)
})

test('a new-bug backprop pairs pending START with its B<n> DONE, and an in-flight sibling survives', async () => {
  const file = ledger('2026-06-05-foo')
  appendFileSync(file, '\n2026-06-05 11:00 ds:backprop pending START\n\n2026-06-05 11:04 ds:backprop B1 DONE\n')
  assert.doesNotMatch((await hook('startup')).ctx, /resume needed.*ds:backprop/i)
  const fresh = ledger('2026-06-05-foo')
  appendFileSync(fresh, '\n2026-06-05 11:00 ds:backprop pending START\n\n2026-06-05 11:02 ds:backprop B9 START\n\n2026-06-05 11:04 ds:backprop B1 DONE\n')
  assert.match((await hook('startup')).ctx, /resume needed.*B9/)
})

test('a START in closeout prose is not a resume; the scan reads Status only', async () => {
  const file = ledger('2026-06-08-zprose')
  appendFileSync(file, '\n## §Z — Closeout\n\ndiscuss the T2 phase START\n')
  assert.doesNotMatch((await hook('startup')).ctx, /phase START/)
})

test('a wave closed in closeout heals into the archive, leaves a breadcrumb and no drift', async () => {
  ledger('2026-06-07-current')
  ledger(
    '2026-06-06-closed',
    '`2026-06-06` · `done` · `P1/1`\n\n## §T — Task ledger\n\n| T1 | P1 | x | done | [a1] | — |\n\n## §S — Rolling status log\n\n2026-06-06 09:00 ds:close — §Z=written\n\n## §Z — Closeout\n\ncomplete: true\n',
  )
  const done = await hook('startup')
  const archived = join(ws, '.scratchpad', 'dossier', '_archive', '2026-06-06-closed', 'DOSSIER.md')
  assert.ok(existsSync(archived))
  assert.ok(!existsSync(join(ws, '.scratchpad', 'dossier', '2026-06-06-closed')))
  assert.doesNotMatch(done.sys, /drift/i)
  assert.match(readFileSync(archived, 'utf8'), /ds:reconcile/)
})

test('with no dossier directory the hook exits 0 with no title', async () => {
  const done = await hook('startup')
  assert.equal(done.code, 0)
  assert.equal(done.title, '')
})

test('the sit-rep counts tasks and shows the last two Status entries under either header spelling', async () => {
  for (const [tasks, status] of [
    ['## §T — Task ledger', '## §S — Rolling status log'],
    ['## Tasks', '## Status'],
  ]) {
    clean()
    ;({ dir: ws, clean } = tempRoot('ds-session-start-'))
    ledger(
      '2026-08-05-sitrep',
      `\`2026-08-05\` · \`live\` · \`P1/1\`\n\n${tasks}\n\n| id | state | who | task    | needs | cite | verify |\n|----|-------|-----|---------|-------|------|--------|\n| T1 | x     | A   | first   | —     | ab12 | —      |\n| T2 | .     | A   | second  | T1    | —    | —      |\n\n${status}\n\n2026-08-05 10:00 ds:new — created slug=2026-08-05-sitrep\n\n2026-08-05 10:05 ds:build T1 DONE\n`,
    )
    const done = await hook('startup', undefined)
    assert.match(done.ctx, / 50% · 1\/2/, tasks)
    assert.equal(done.ctx.match(/just did:/g)?.length, 2, status)
  }
})

test('one live wave raises a nudge to the sit-rep with its progress line, on every operator start', async () => {
  ledger('2026-06-05-foo')
  const done = await hook('startup')
  assert.match(done.sys, /2026-06-05-foo/)
  assert.match(done.sys, /ds:status|\/dossier:status/)
  assert.match(done.sys, /2026-06-05-foo 0% · /)
  for (const source of ['resume', 'fork', 'clear']) assert.match((await hook(source)).sys, /2026-06-05-foo/, source)
})

test('compact and the opt-out raise no nudge but keep the live wave in the context', async () => {
  ledger('2026-06-05-foo')
  const compact = await hook('compact')
  assert.equal(compact.sys, '')
  assert.match(compact.ctx, /2026-06-05-foo/)
  const off = await hook('startup', '', { DOSSIER_SESSION_TITLE: '1', DOSSIER_LIVE_NUDGE: '0' })
  assert.equal(off.sys, '')
  assert.ok(off.hasContext)
})

test('two live waves raise the consolidate warning; none raises no message', async () => {
  ledger('2026-06-05-foo')
  ledger('2026-06-06-bar')
  assert.match((await hook('startup')).sys, /2 live/)
  clean()
  ;({ dir: ws, clean } = tempRoot('ds-session-start-'))
  mkdirSync(join(ws, '.scratchpad', 'dossier', '_archive'), { recursive: true })
  assert.equal((await hook('startup')).sys, '')
})
