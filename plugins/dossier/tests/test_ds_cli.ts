import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const REGISTRY = [
  { id: 'V1', pattern: 'eval\\(', message: 'no eval', paths: ['src/*.py'] },
  { id: 'V9', pattern: '(?x) a b' },
]

async function withRoot(body: (root: string) => void | Promise<void>): Promise<void> {
  const { dir: root, clean } = tempRoot('ds-cli-')
  try {
    mkdirSync(join(root, '.scratchpad', 'dossier'), { recursive: true })
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify(REGISTRY))
    await body(root)
  } finally {
    clean()
  }
}

function check(root: string, filePath: string, text: string) {
  const input = JSON.stringify({ file_path: filePath, chunks: [text] })
  return ds(root, ['invariant-check', root], {}, input)
}

test('invariant-check exits 1 with the reason on a registered pattern', async () => {
  await withRoot(async (root) => {
    const done = await check(root, 'src/app.py', 'x = eval(y)')
    assert.equal(done.code, 1, done.stderr)
    assert.match(done.stdout, /violates §V V1/)
  })
})

test('invariant-check exits 0 off the pattern and off the scope, and names a skipped pattern', async () => {
  await withRoot(async (root) => {
    const clean = await check(root, 'src/app.py', 'x = safe(y)')
    assert.equal(clean.code, 0, clean.stderr)
    assert.match(clean.stdout, /§V V9 not checked/)
    assert.equal((await check(root, 'lib/app.py', 'eval(')).code, 0)
  })
})

test('invariant-check exits 0 on a malformed registry or payload', async () => {
  await withRoot(async (root) => {
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), 'not json')
    assert.equal((await check(root, 'src/app.py', 'eval(')).code, 0)
  })
  await withRoot(async (root) => {
    const done = await ds(root, ['invariant-check', root], {}, 'garbage')
    assert.equal(done.code, 0, done.stderr)
  })
})

function logVerdict(root: string, payload: Record<string, unknown>) {
  return ds(root, ['verdict-log', root], {}, JSON.stringify(payload))
}

test('verdict-log appends one record per verdict-agent stop, keyed by agent id', async () => {
  await withRoot(async (root) => {
    const log = join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')
    const stop = { agent_type: 'whetstone:whetstone-doubter', agent_id: 'a1', last_assistant_message: 'DOUBT: FAILURES\n- x' }
    assert.equal((await logVerdict(root, stop)).code, 0)
    assert.equal((await logVerdict(root, { agent_type: 'dossier:dossier-reviewer', agent_id: 'a2', last_assistant_message: 'no verdict here' })).code, 0)
    assert.equal((await logVerdict(root, { agent_type: 'dossier:dossier-reviewer', agent_id: 'a3' })).code, 0)
    const records = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
    assert.deepEqual(
      records.map(({ agent_type, agent_id, verdicts }) => ({ agent_type, agent_id, verdicts })),
      [
        { agent_type: 'whetstone:whetstone-doubter', agent_id: 'a1', verdicts: ['DOUBT: FAILURES'] },
        { agent_type: 'dossier:dossier-reviewer', agent_id: 'a2', verdicts: [] },
        { agent_type: 'dossier:dossier-reviewer', agent_id: 'a3', verdicts: null },
      ],
    )
    assert.match(String(records[0]?.ts), /^\d{4}-\d{2}-\d{2}T/)
  })
})

test('verdict-log reads a structured-output verdict from the agent transcript', async () => {
  await withRoot(async (root) => {
    let agents = 0
    const stopAt = (path: string) => ({ agent_type: 'reviewer', agent_transcript_path: path })
    const turn = (...content: unknown[]) => JSON.stringify({ message: { content } })
    const ended = (input: unknown) => {
      agents += 1
      const path = join(root, `agent-${agents}.jsonl`)
      const earlier = turn({ type: 'text', text: 'REVIEW: PASS' })
      const call = turn({ type: 'tool_use', name: 'StructuredOutput', input })
      writeFileSync(path, `${[earlier, 'not json', 'null', turn(null, 7), call].join('\n')}\n`)
      return stopAt(path)
    }
    const stops = [
      ended({ findings: [{ title: 'a' }, { title: 'b' }] }),
      ended({ findings: [{ title: 'a' }] }),
      ended({ findings: [] }),
      ended({ real: true, why: 'holds' }),
      ended({ real: false, why: 'refuted' }),
      ended({ verdicts: [{ index: 0, real: false }, { index: 1, real: true }, { index: 2 }] }),
      ended({ other: 1 }),
      stopAt(join(root, 'missing.jsonl')),
      stopAt(root),
    ]
    for (const stop of stops) assert.equal((await logVerdict(root, stop)).code, 0)
    const log = join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')
    const verdicts = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as Record<string, unknown>).verdicts)
    const reviews = [['REVIEW: 2 findings'], ['REVIEW: 1 finding'], ['REVIEW: clean']]
    const findings = [['FINDING: real'], ['FINDING: not real'], ['FINDING: not real', 'FINDING: real']]
    assert.deepEqual(verdicts, [...reviews, ...findings, [], null, null])
  })
})

test('verdict-log writes nothing for another agent, outside a dossier project, or on a bad payload', async () => {
  await withRoot(async (root) => {
    assert.equal((await logVerdict(root, { agent_type: 'general-purpose', last_assistant_message: 'REVIEW: PASS' })).code, 0)
    const bad = await ds(root, ['verdict-log', root], {}, 'garbage')
    assert.equal(bad.code, 0, bad.stderr)
    assert.equal(existsSync(join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')), false)
  })
  const { dir: bare, clean } = tempRoot('ds-cli-')
  try {
    const stop = { agent_type: 'dossier:dossier-reviewer', last_assistant_message: 'REVIEW: PASS' }
    assert.equal((await logVerdict(bare, stop)).code, 0)
    assert.equal(existsSync(join(bare, '.scratchpad')), false)
  } finally {
    clean()
  }
})

test('ds exits 64 on an unknown verb', () => {
  assert.equal(spawnSync('sh', [DS, 'nope'], { encoding: 'utf8' }).status, 64)
})

test('ds exits 69 when node is not on PATH', () => {
  const done = spawnSync('/bin/sh', [DS, 'invariant-check'], { encoding: 'utf8', env: { PATH: '/nonexistent' } })
  assert.equal(done.status, 69)
  assert.match(done.stderr, /node 22\.18\+ required/)
})

test('ds exits 70 with one internal-error line when a verb throws', async () => {
  await withRoot((root) => {
    const ledger = join(root, '.scratchpad', 'dossier', 'w', 'DOSSIER.md')
    mkdirSync(join(ledger, '..'))
    writeFileSync(ledger, '# w\n')
    chmodSync(ledger, 0o000)
    const done = spawnSync('sh', [DS, 'regen-index'], { cwd: root, encoding: 'utf8' })
    chmodSync(ledger, 0o644)
    assert.equal(done.status, 70, done.stderr)
    assert.match(done.stderr, /^ds: internal error: EACCES/)
  })
})

test('session-start reads its payload from a real stdin pipe and fails open on a bad one', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ds-stdin-')))
  try {
    mkdirSync(join(dir, '.scratchpad', 'dossier', '2026-06-05-foo'), { recursive: true })
    writeFileSync(join(dir, '.scratchpad', 'dossier', '2026-06-05-foo', 'DOSSIER.md'), '`2026-06-05` · `live` · `P1/1`\n\n## Tasks\n\n## Status\n')
    const run = (input: string) =>
      spawnSync('sh', [DS, 'session-start'], { cwd: dir, input, encoding: 'utf8', env: { ...process.env, DOSSIER_SESSION_TITLE: '1' } })
    const good = run('{"hook_event_name":"SessionStart","source":"startup","session_title":""}')
    assert.equal(good.status, 0, good.stderr)
    assert.equal(JSON.parse(good.stdout).hookSpecificOutput.sessionTitle, '2026-06-05-foo')
    const bad = run('not json at all')
    assert.equal(bad.status, 0, bad.stderr)
    assert.equal(JSON.parse(bad.stdout).hookSpecificOutput.sessionTitle, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a criterion does not inherit the ledger root ds set for itself, and keeps one the caller set', async () => {
  await withRoot((root) => {
    const wave = join(root, '.scratchpad', 'dossier', '2026-10-09-w')
    mkdirSync(wave)
    writeFileSync(join(wave, 'DOSSIER.md'), '# w\n\n`2026-10-09` · `live` · `P1/1`\n')
    const probe = '`test -z "$DOSSIER_LEDGER_ROOT$DOSSIER_SCRATCHPAD_ROOT"`'
    writeFileSync(
      join(wave, 'CONTRACT.md'),
      `| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | ${probe} | exit 0 |\n`,
    )
    const env = { ...process.env }
    delete env.DOSSIER_LEDGER_ROOT
    delete env.DOSSIER_SCRATCHPAD_ROOT
    const clean = spawnSync('sh', [DS, 'converge'], { cwd: root, encoding: 'utf8', env })
    assert.match(clean.stdout, /CONVERGE: MET/, clean.stdout + clean.stderr)
    const given = spawnSync('sh', [DS, 'converge', join(wave, 'CONTRACT.md')], { cwd: root, encoding: 'utf8', env: { ...env, DOSSIER_LEDGER_ROOT: '/given' } })
    assert.match(given.stdout, /UNMET 1/, given.stdout + given.stderr)
  })
})

function wave(root: string, rel: string, token: string, closeout = ''): void {
  const dir = join(root, '.scratchpad', 'dossier', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), `# w\n\n\`2026-10-09\` · \`${token}\` · \`P1/1\`\n\n## Closeout\n\n${closeout}\n`)
}

test('ds-check names a hand-closed archive and a contract with no open wave, and exits 0 on them', async () => {
  await withRoot(async (root) => {
    wave(root, '_archive/2026-09-29-handmade', 'done', 'closed by hand')
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier'))
    writeFileSync(join(root, '.dossier', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = await ds(root, ['ds-check', '.scratchpad'])
    assert.equal(done.code, 0, done.stderr)
    assert.deepEqual(done.stdout.trim().split('\n'), [
      'advisory: 2026-09-29-handmade is archived with no §Z closure key — `ds close` on it writes one',
      'advisory: .dossier/2026-09-28-proper.md belongs to no open wave — move it to .dossier/_archive/',
    ])
  })
})

test('ds-check prints nothing on a tree whose archives and contracts agree', async () => {
  await withRoot(async (root) => {
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier', '_archive'), { recursive: true })
    writeFileSync(join(root, '.dossier', '_archive', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = await ds(root, ['ds-check', '.scratchpad'])
    assert.equal(done.code, 0, done.stderr)
    assert.equal(done.stdout, '')
  })
})
