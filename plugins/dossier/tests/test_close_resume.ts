import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { archived, cleanTemplates, close, DS, ledger, must, run, SLUG, within } from './close_kit.ts'

afterAll(cleanTemplates)

test('a rerun finishes a close that a crash left after §Z, even once reconcile archived it', async () => {
  await within(
    async (root) => {
      const dir = join(root, '.scratchpad', 'dossier', SLUG)
      await must('sh', [DS, 'z-write', dir, 'complete', '—', 'early', 'abc1234'], root)
      await must('sh', [DS, 'header-state', dir, 'done'], root)
      await must('sh', [DS, 'reconcile', '.scratchpad'], root)
      assert.ok(existsSync(join(root, '.scratchpad', 'dossier', '_archive', SLUG)))
      const done = await close(root, '--complete')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.ok(existsSync(join(root, '.dossier', '_archive', `${SLUG}.md`)))
      assert.match(archived(root), /ds:close — DONE/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--successor copies carried rows into the successor once, even when a crash left the copy before §Z', async () => {
  await within(
    async (root) => {
      const next = join(root, '.scratchpad', 'dossier', '2026-10-10-next')
      mkdirSync(next)
      const copied = '| T2 | . | H | task T2 (from wave T2) | — | — | v |'
      writeFileSync(
        join(next, 'DOSSIER.md'),
        ledger([['T1', '.', 'A']])
          .replace('# wave', '# next')
          .replace(/^(\| T1 .*)$/m, `$1\n${copied}`),
      )
      await must('sh', [DS, 's-append', join(root, '.scratchpad', 'dossier', SLUG), 'ds:close — START mode=successor carry=T2 converge=met:1/1'], root)
      const done = await close(root, '--successor', 'next', '--carry', 'T2', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      const text = readFileSync(join(next, 'DOSSIER.md'), 'utf8')
      assert.equal(text.match(/\(from wave T2\)/g)?.length, 1)
      assert.match(archived(root), /^successor: next$/m)
      assert.ok(!existsSync(join(root, '.scratchpad', 'dossier', 'LATER.md')), 'a successor carry stays off the carried-work list')
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
    ],
  )
})

test('--successor appends a delayed carried row under the successor tasks and records it', async () => {
  await within(
    async (root) => {
      const next = join(root, '.scratchpad', 'dossier', '2026-10-10-next')
      mkdirSync(next)
      writeFileSync(join(next, 'DOSSIER.md'), ledger([['T1', '.', 'A']]).replace('# wave', '# next'))
      const done = await close(root, '--successor', 'next', '--carry', 'T2', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(
        readFileSync(join(next, 'DOSSIER.md'), 'utf8'),
        /^\| T1 .*\n\| T2 \| \. \| A \| task T2 \(from wave T2, after wave T1\+7d\) \| — \| — \| v \|$/m,
      )
      assert.match(archived(root), /ds:close — carried=T2→T2 into next/)
      assert.match(archived(root), /^after: T2 task T2 \(T1\+7d\)$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'A', 'T1+7d'],
    ],
  )
})

test('a rerun finishes a close that a crash left after §Z on a live wave', async () => {
  await within(
    async (root) => {
      const dir = join(root, '.scratchpad', 'dossier', SLUG)
      await must('sh', [DS, 'z-write', dir, 'complete', '—', 'early', 'abc1234'], root)
      const done = await close(root, '--complete')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.ok(!existsSync(dir))
      assert.match(archived(root), /^`2026-10-09` · `done`$/m)
      assert.match(archived(root), /ds:close — DONE/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a hand-closed archive gets its §Z written in place, and ds-check names an unfinished close', async () => {
  await within(
    async (root) => {
      const archive = join(root, '.scratchpad', 'dossier', '_archive')
      mkdirSync(archive)
      await must('sh', [DS, 'header-state', join(root, '.scratchpad', 'dossier', SLUG), 'done'], root)
      await must('mv', [join(root, '.scratchpad', 'dossier', SLUG), archive])
      await must('sh', [DS, 's-append', join(archive, SLUG), 'ds:close — START mode=complete carry=— converge=skipped'], root)
      const check = await run('sh', [DS, 'ds-check', '.scratchpad'], root)
      assert.match(check.stdout, new RegExp(`advisory: ${SLUG} close did not finish — \`ds close ${SLUG}\` resumes it`))
      const done = await close(root, '--complete', '--summary', 'closed by hand earlier')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /^complete: true$/m)
      assert.match(archived(root), /ds:close — DONE/)
    },
    [['T1', 'x', 'A']],
  )
})
