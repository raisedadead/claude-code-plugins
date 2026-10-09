import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test as base } from 'vitest'

const test = base.concurrent
const execFileAsync = promisify(execFile)

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const SLUG = '2026-10-09-wave'

type Row = [id: string, state: string, who: string, needs?: string]

type Run = { status: number; stdout: string; stderr: string }

async function run(file: string, args: string[], cwd?: string): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { cwd, encoding: 'utf8' })
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof failed.code !== 'number') throw error
    return { status: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' }
  }
}

async function must(file: string, args: string[], cwd?: string): Promise<string> {
  const done = await run(file, args, cwd)
  assert.equal(done.status, 0, `${file} ${args.join(' ')}: ${done.stderr}`)
  return done.stdout
}

function ledger(rows: Row[], bugs = ''): string {
  const tasks = rows.map(([id, state, who, needs = '—']) => `| ${id} | ${state} | ${who} | task ${id} | ${needs} | ${state === 'x' ? 'abc1234' : '—'} | v |`)
  return [
    '# wave',
    '',
    '`2026-10-09` · `live` · `P1/1`',
    '',
    '## Goal',
    '',
    'g',
    '',
    '## Tasks',
    '',
    '| id | state | who | task | needs | cite | verify |',
    '|----|-------|-----|------|-------|------|--------|',
    ...tasks,
    '',
    '## Bugs',
    '',
    '| id | bug | root cause | invariant added | fix cite |',
    '|----|-----|------------|-----------------|----------|',
    ...(bugs ? [bugs] : []),
    '',
    '## Repos',
    '',
    '| repo | branch | ahead | tag | pushed | notes |',
    '|------|--------|-------|-----|--------|-------|',
    '',
    '## Status',
    '',
    '2026-10-09 09:00 ds:new — created slug=wave',
    '',
    '## Closeout',
    '',
    '_(empty — written by ds:close)_',
    '',
  ].join('\n')
}

function contract(criterion = '`true`'): string {
  return `# wave\n\n| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | ${criterion} | exit 0 |\n`
}

async function repo(rows: Row[], options: { criterion?: string; bugs?: string } = {}): Promise<string> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-close-')))
  const git = (...args: string[]) => must('git', ['-C', root, ...args])
  await git('init', '-q', '-b', 'main')
  await git('config', 'user.email', 't@t')
  await git('config', 'user.name', 't')
  writeFileSync(join(root, '.gitignore'), '.scratchpad/\n')
  mkdirSync(join(root, '.dossier'))
  writeFileSync(join(root, '.dossier', `${SLUG}.md`), contract(options.criterion))
  await git('add', '.')
  await git('commit', '-q', '-m', 'init')
  mkdirSync(join(root, '.scratchpad', 'dossier', SLUG), { recursive: true })
  writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), ledger(rows, options.bugs))
  return root
}

function close(root: string, ...args: string[]): Promise<Run> {
  return run('sh', [DS, 'close', SLUG, ...args], root)
}

function live(root: string): string {
  return readFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), 'utf8')
}

function archived(root: string): string {
  return readFileSync(join(root, '.scratchpad', 'dossier', '_archive', SLUG, 'DOSSIER.md'), 'utf8')
}

async function lastSubject(root: string): Promise<string> {
  return (await must('git', ['-C', root, 'log', '-1', '--format=%s'])).trim()
}

async function within(body: (root: string) => Promise<void>, rows: Row[], options: { criterion?: string; bugs?: string } = {}): Promise<void> {
  const root = await repo(rows, options)
  try {
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('--plan names the open agent rows, refuses with exit 1 and writes nothing', async () => {
  await within(
    async (root) => {
      const before = live(root)
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 1, done.stdout + done.stderr)
      assert.match(done.stdout, /✗ T2 open/)
      assert.equal(live(root), before)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'A'],
    ],
  )
})

test('--plan on a finished wave reports ready with exit 0 and writes nothing', async () => {
  await within(
    async (root) => {
      const before = live(root)
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /✓ converge 1\/1/)
      assert.match(done.stdout, /^ready$/m)
      assert.match(done.stdout, /⚠ no CHANGELOG\.md changed since the contract commit/)
      assert.equal(live(root), before)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan says the changelog check did not run when the contract is untracked', async () => {
  await within(
    async (root) => {
      rmSync(join(root, '.dossier'), { recursive: true, force: true })
      writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'CONTRACT.md'), contract())
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /⚠ no tracked contract — the CHANGELOG\.md check did not run/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on the changelog advisory once a CHANGELOG.md changes after the contract', async () => {
  await within(
    async (root) => {
      mkdirSync(join(root, 'plugins', 'p'), { recursive: true })
      writeFileSync(join(root, 'plugins', 'p', 'CHANGELOG.md'), '# Changelog\n')
      await must('git', ['-C', root, 'add', '.'])
      await must('git', ['-C', root, 'commit', '-q', '-m', 'docs: changelog'])
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on the changelog advisory for a staged CHANGELOG.md not yet committed', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n')
      await must('git', ['-C', root, 'add', 'CHANGELOG.md'])
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--plan stays silent on the changelog advisory for a CHANGELOG.md not yet added', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'CHANGELOG.md'), '# Changelog\n')
      const done = await close(root, '--complete', '--plan')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.doesNotMatch(done.stdout, /CHANGELOG/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a run writes §Z, archives the wave, commits the contract move alone and logs DONE', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, 'unrelated.txt'), 'x')
      await must('git', ['-C', root, 'add', 'unrelated.txt'])
      const done = await close(root, '--complete', '--summary', 'shipped it')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      const text = archived(root)
      assert.match(text, /^`2026-10-09` · `done`$/m)
      assert.match(text, /^complete: true$/m)
      assert.match(text, /^summary: shipped it$/m)
      const sha = (await must('git', ['-C', root, 'rev-parse', '--short', 'HEAD'])).trim()
      for (const step of ['START mode=complete', '§Z=written', 'archived', `contract=${sha}`, 'DONE']) {
        assert.ok(text.includes(`ds:close — ${step}`), step)
      }
      assert.ok(!existsSync(join(root, '.scratchpad', 'dossier', SLUG)))
      assert.ok(!existsSync(join(root, '.scratchpad', 'dossier', '_archive', SLUG, '.ds-lock')))
      assert.ok(existsSync(join(root, '.dossier', '_archive', `${SLUG}.md`)))
      assert.equal(await lastSubject(root), `chore(dossier): archive wave contract ${SLUG}`)
      const staged = await must('git', ['-C', root, 'diff', '--cached', '--name-only'])
      assert.equal(staged.trim(), 'unrelated.txt')
      assert.match(readFileSync(join(root, '.scratchpad', 'INDEX.md'), 'utf8'), /\| wave \| done \|/)
    },
    [['T1', 'x', 'A']],
  )
})

test('--carry takes an operator row and a delayed row into an after line, and refuses a plain agent row', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--plan', '--carry', 'T2,T3,T4')
      assert.equal(refused.status, 1)
      assert.match(refused.stdout, /✗ T4 cannot carry/)
      await must('sh', [DS, 'row-flip', join(root, '.scratchpad', 'dossier', SLUG), 'T4', 'x', 'def5678'], root)
      const done = await close(root, '--complete', '--carry', 'T2,T3', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /^after: T2 task T2 \(H\); T3 task T3 \(T1\+7d\)$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
      ['T3', '.', 'A', 'T1+7d'],
      ['T4', '.', 'A', 'T1'],
    ],
  )
})

test('an unmet criterion refuses unless --accept-unmet, which records the ids', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--summary', 's')
      assert.equal(refused.status, 1)
      assert.match(refused.stdout, /✗ converge unmet 1/)
      assert.ok(existsSync(join(root, '.scratchpad', 'dossier', SLUG)))
      const done = await close(root, '--complete', '--accept-unmet', '--summary', 's')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /ds:close — START mode=complete carry=— converge=unmet:1 accepted/)
    },
    [['T1', 'x', 'A']],
    { criterion: '`false`' },
  )
})

test('an open bug refuses --complete, and --abandon closes over open rows and bugs', async () => {
  await within(
    async (root) => {
      const refused = await close(root, '--complete', '--plan')
      assert.match(refused.stdout, /✗ B1 has no fix cite/)
      const done = await close(root, '--abandon', 'dropped', '--summary', 'not needed')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(archived(root), /^abandoned: true$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'A'],
    ],
    { bugs: '| B1 | b | r | — | — |' },
  )
})

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

test('a refused contract commit leaves the close resumable, and the rerun commits the move', async () => {
  await within(
    async (root) => {
      const hook = join(root, '.git', 'hooks', 'pre-commit')
      writeFileSync(hook, '#!/bin/sh\nexit 1\n')
      chmodSync(hook, 0o755)
      const first = await close(root, '--complete', '--summary', 's')
      assert.equal(first.status, 1, first.stdout + first.stderr)
      assert.doesNotMatch(archived(root), /ds:close — DONE/)
      rmSync(hook)
      const second = await close(root, '--complete')
      assert.equal(second.status, 0, second.stdout + second.stderr)
      assert.equal(await lastSubject(root), `chore(dossier): archive wave contract ${SLUG}`)
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

test('a run without a summary or a mode is a usage error', async () => {
  await within(
    async (root) => {
      assert.equal((await close(root, '--complete')).status, 64)
      assert.equal((await close(root, '--summary', 's')).status, 64)
    },
    [['T1', 'x', 'A']],
  )
})

async function refusal(root: string, ...args: string[]): Promise<string> {
  const done = await close(root, ...args)
  assert.equal(done.status, 1, done.stdout + done.stderr)
  return done.stdout + done.stderr
}

test('a done row with no cite refuses --complete', async () => {
  await within(
    async (root) => {
      const file = join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md')
      writeFileSync(file, live(root).replace('| abc1234 |', '| — |'))
      assert.match(await refusal(root, '--complete', '--plan'), /✗ T1 done with no cite/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a successor that does not exist refuses', async () => {
  await within(async (root) => assert.match(await refusal(root, '--successor', 'ghost', '--plan'), /✗ successor ghost not found/), [['T1', 'x', 'A']])
})

test('a successor with no Tasks table refuses the carry and leaves §Z unwritten', async () => {
  await within(
    async (root) => {
      const next = join(root, '.scratchpad', 'dossier', '2026-10-10-next')
      mkdirSync(next)
      writeFileSync(join(next, 'DOSSIER.md'), '# next\n\n## Goal\n\ng\n')
      assert.match(await refusal(root, '--successor', 'next', '--carry', 'T2', '--summary', 's'), /successor 2026-10-10-next has no Tasks table/)
      assert.doesNotMatch(live(root), /^successor: next$/m)
    },
    [
      ['T1', 'x', 'A'],
      ['T2', '.', 'H'],
    ],
  )
})

test('a held lock refuses a fresh close and a resume of a sealed one', async () => {
  await within(
    async (root) => {
      const dir = join(root, '.scratchpad', 'dossier', SLUG)
      writeFileSync(join(dir, '.ds-lock'), JSON.stringify({ pid: process.pid, started: new Date().toISOString(), skill: 'ds:build', target: 'T1' }))
      assert.match(await refusal(root, '--complete', '--summary', 's'), /✗ locked by ds:build/)
      await must('sh', [DS, 'z-write', dir, 'complete', '—', 'early', 'abc1234'], root)
      assert.match(await refusal(root, '--complete'), /✗ locked by ds:build/)
      assert.ok(existsSync(dir))
    },
    [['T1', 'x', 'A']],
  )
})

test('an unfinished close that started with another mode refuses', async () => {
  await within(
    async (root) => {
      await must('sh', [DS, 's-append', join(root, '.scratchpad', 'dossier', SLUG), 'ds:close — START mode=abandoned carry=— converge=skipped'], root)
      assert.match(await refusal(root, '--complete', '--summary', 's'), /an unfinished close started with another mode/)
    },
    [['T1', 'x', 'A']],
  )
})

test('a merge in progress refuses the contract retire and leaves the close resumable', async () => {
  await within(
    async (root) => {
      writeFileSync(join(root, '.git', 'MERGE_HEAD'), await must('git', ['-C', root, 'rev-parse', 'HEAD']))
      assert.match(await refusal(root, '--complete', '--summary', 's'), /has a merge in progress/)
      assert.doesNotMatch(archived(root), /ds:close — DONE/)
      assert.ok(existsSync(join(root, '.dossier', `${SLUG}.md`)))
    },
    [['T1', 'x', 'A']],
  )
})

test('a contract that converge cannot parse refuses unless --accept-unmet', async () => {
  await within(
    async (root) => {
      writeFileSync(
        join(root, '.dossier', `${SLUG}.md`),
        '# wave\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `true` | exit 0 |\n',
      )
      assert.match(await refusal(root, '--complete', '--plan'), /✗ converge did not run/)
      const done = await close(root, '--complete', '--plan', '--accept-unmet')
      assert.equal(done.status, 0, done.stdout + done.stderr)
      assert.match(done.stdout, /⚠ converge did not run: .* — accepted/)
    },
    [['T1', 'x', 'A']],
  )
})
