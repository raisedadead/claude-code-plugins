import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')
const REGISTRY = [
  { id: 'V1', pattern: 'eval\\(', message: 'no eval', paths: ['src/*.py'] },
  { id: 'V9', pattern: '(?x) a b' },
]

function withRoot(body: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'ds-cli-'))
  try {
    mkdirSync(join(root, '.scratchpad', 'dossier'), { recursive: true })
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify(REGISTRY))
    body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function check(root: string, filePath: string, text: string) {
  const input = JSON.stringify({ file_path: filePath, chunks: [text] })
  return spawnSync('sh', [DS, 'invariant-check', root], { input, encoding: 'utf8' })
}

test('invariant-check exits 1 with the reason on a registered pattern', () => {
  withRoot((root) => {
    const done = check(root, 'src/app.py', 'x = eval(y)')
    assert.equal(done.status, 1, done.stderr)
    assert.match(done.stdout, /violates §V V1/)
  })
})

test('invariant-check exits 0 off the pattern and off the scope, and names a skipped pattern', () => {
  withRoot((root) => {
    const clean = check(root, 'src/app.py', 'x = safe(y)')
    assert.equal(clean.status, 0, clean.stderr)
    assert.match(clean.stdout, /§V V9 not checked/)
    assert.equal(check(root, 'lib/app.py', 'eval(').status, 0)
  })
})

test('invariant-check exits 0 on a malformed registry or payload', () => {
  withRoot((root) => {
    writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), 'not json')
    assert.equal(check(root, 'src/app.py', 'eval(').status, 0)
  })
  withRoot((root) => {
    const done = spawnSync('sh', [DS, 'invariant-check', root], { input: 'garbage', encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
  })
})

function logVerdict(root: string, payload: Record<string, unknown>) {
  return spawnSync('sh', [DS, 'verdict-log', root], { input: JSON.stringify(payload), encoding: 'utf8' })
}

test('verdict-log appends one record per verdict-agent stop, keyed by agent id', () => {
  withRoot((root) => {
    const log = join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')
    const stop = { agent_type: 'whetstone:whetstone-doubter', agent_id: 'a1', last_assistant_message: 'DOUBT: FAILURES\n- x' }
    assert.equal(logVerdict(root, stop).status, 0)
    assert.equal(logVerdict(root, { agent_type: 'dossier:dossier-reviewer', agent_id: 'a2', last_assistant_message: 'no verdict here' }).status, 0)
    assert.equal(logVerdict(root, { agent_type: 'dossier:dossier-reviewer', agent_id: 'a3' }).status, 0)
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

test('verdict-log reads a structured-output verdict from the agent transcript', () => {
  withRoot((root) => {
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
      ended({ other: 1 }),
      stopAt(join(root, 'missing.jsonl')),
      stopAt(root),
    ]
    for (const stop of stops) assert.equal(logVerdict(root, stop).status, 0)
    const log = join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')
    const verdicts = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((line) => (JSON.parse(line) as Record<string, unknown>).verdicts)
    const reviews = [['REVIEW: 2 findings'], ['REVIEW: 1 finding'], ['REVIEW: clean']]
    const findings = [['FINDING: real'], ['FINDING: not real']]
    assert.deepEqual(verdicts, [...reviews, ...findings, [], null, null])
  })
})

test('verdict-log writes nothing for another agent, outside a dossier project, or on a bad payload', () => {
  withRoot((root) => {
    assert.equal(logVerdict(root, { agent_type: 'general-purpose', last_assistant_message: 'REVIEW: PASS' }).status, 0)
    const bad = spawnSync('sh', [DS, 'verdict-log', root], { input: 'garbage', encoding: 'utf8' })
    assert.equal(bad.status, 0, bad.stderr)
    assert.equal(existsSync(join(root, '.scratchpad', 'dossier', '.verdicts.jsonl')), false)
  })
  const bare = mkdtempSync(join(tmpdir(), 'ds-cli-'))
  try {
    const stop = { agent_type: 'dossier:dossier-reviewer', last_assistant_message: 'REVIEW: PASS' }
    assert.equal(logVerdict(bare, stop).status, 0)
    assert.equal(existsSync(join(bare, '.scratchpad')), false)
  } finally {
    rmSync(bare, { recursive: true, force: true })
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

test('ds exits 70 with one internal-error line when a verb throws', () => {
  withRoot((root) => {
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

test('a verb run from a linked worktree writes the primary checkout ledger', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt-')))
  const main = join(base, 'repo')
  try {
    mkdirSync(join(main, '.scratchpad', 'dossier'), { recursive: true })
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', join(base, 'repo.feature'), '-b', 'feature')
    const done = spawnSync('sh', [DS, 'regen-index'], { cwd: join(base, 'repo.feature'), encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'INDEX.md')))
    assert.ok(!existsSync(join(base, 'repo.feature', '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('with no ledger anywhere, the first ledger from a linked worktree lands in the primary checkout', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    mkdirSync(main)
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    const root = spawnSync('sh', [DS, 'root'], { cwd: join(feature), encoding: 'utf8' })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${main}\n`)
    const done = spawnSync('sh', [DS, 'grill-add', '.scratchpad', 'probe', 'FACT: x cite=y'], { cwd: feature, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.ok(existsSync(join(main, '.scratchpad', 'dossier', '.grill')))
    assert.ok(!existsSync(join(feature, '.scratchpad')))
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('with no ledger, a submodule keeps its own directory and a bare primary roots beside the bare repo', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sub-')))
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], { stdio: 'ignore' })
  const root = (cwd: string) => spawnSync('sh', [DS, 'root'], { cwd, encoding: 'utf8' })
  try {
    for (const name of ['lib', 'sup']) {
      mkdirSync(join(base, name))
      git(join(base, name), 'init', '-q')
      git(join(base, name), 'commit', '-q', '--allow-empty', '-m', 'init')
    }
    git(join(base, 'sup'), 'submodule', 'add', '-q', join(base, 'lib'), 's')
    assert.equal(root(join(base, 'sup', 's')).stdout, `${join(base, 'sup', 's')}\n`)
    mkdirSync(join(base, 'lib', 'pkg'))
    assert.equal(root(join(base, 'lib', 'pkg')).stdout, `${join(base, 'lib')}\n`)
    git(base, 'clone', '-q', '--bare', join(base, 'lib'), join(base, 'bare', 'repo.git'))
    git(join(base, 'bare', 'repo.git'), 'worktree', 'add', '-q', join(base, 'bare', 'feat'))
    assert.equal(root(join(base, 'bare', 'feat')).stdout, `${join(base, 'bare')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a linked worktree of a primary with a separate git dir roots at itself and ignores a ledger in the git dir', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-sep-')))
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { stdio: 'ignore' })
  try {
    mkdirSync(join(base, 'store'))
    git(base, 'init', '-q', `--separate-git-dir=${join(base, 'store', 'sep.git')}`, 'sep')
    git(join(base, 'sep'), 'commit', '-q', '--allow-empty', '-m', 'init')
    git(join(base, 'sep'), 'worktree', 'add', '-q', join(base, 'sep.feat'))
    mkdirSync(join(base, 'sep', '.scratchpad', 'dossier'), { recursive: true })
    mkdirSync(join(base, 'store', 'sep.git', '.scratchpad', 'dossier'), { recursive: true })
    const root = spawnSync('sh', [DS, 'root'], { cwd: join(base, 'sep.feat'), encoding: 'utf8' })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${join(base, 'sep.feat')}\n`)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
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

test('outside git, with no ledger, the ledger root is the current directory', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ds-nogit-')))
  try {
    const root = spawnSync('sh', [DS, 'root'], { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_CEILING_DIRECTORIES: tmpdir() } })
    assert.equal(root.status, 0, root.stderr)
    assert.equal(root.stdout, `${dir}\n`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('from a linked worktree, x-refresh reads the worktree repo and converge finds the wave contract', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt2-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const wave = join(main, '.scratchpad', 'dossier', '2026-10-03-w')
    mkdirSync(wave, { recursive: true })
    writeFileSync(
      join(wave, 'DOSSIER.md'),
      '# w\n\n`2026-10-03` · `live` · `P1/1`\n\n## Repos\n\n| repo | branch | ahead | tag | pushed | notes |\n|------|--------|-------|-----|--------|-------|\n| app | main | 0 | — | no | |\n',
    )
    writeFileSync(
      join(wave, 'CONTRACT.md'),
      '| field | value |\n|---|---|\n| consumer | t |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `test -f here.txt` | exit 0 |\n',
    )
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    writeFileSync(join(feature, 'here.txt'), '')
    const refresh = spawnSync('sh', [DS, 'x-refresh', '.scratchpad/dossier/2026-10-03-w', 'app', '.'], { cwd: feature, encoding: 'utf8' })
    assert.equal(refresh.status, 0, refresh.stderr)
    assert.match(readFileSync(join(wave, 'DOSSIER.md'), 'utf8'), /\| app \| feature \|/)
    const converge = spawnSync('sh', [DS, 'converge'], { cwd: feature, encoding: 'utf8' })
    assert.match(converge.stdout, /CONVERGE: MET/, converge.stdout + converge.stderr)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

test('a criterion does not inherit the ledger root ds set for itself, and keeps one the caller set', () => {
  withRoot((root) => {
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

test('from a linked worktree, converge and the prompt state find a tracked contract on the feature branch', () => {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'ds-wt3-')))
  const main = join(base, 'repo')
  const feature = join(base, 'repo.feature')
  try {
    const wave = join(main, '.scratchpad', 'dossier', '2026-10-09-w')
    mkdirSync(wave, { recursive: true })
    writeFileSync(join(wave, 'DOSSIER.md'), '# w\n\n`2026-10-09` · `live` · `P1/1`\n')
    const git = (...args: string[]) => execFileSync('git', ['-C', main, ...args], { stdio: 'ignore' })
    git('init', '-q', '-b', 'main')
    git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init')
    git('worktree', 'add', '-q', feature, '-b', 'feature')
    mkdirSync(join(feature, '.dossier'))
    writeFileSync(
      join(feature, '.dossier', '2026-10-09-w.md'),
      '# w\n\n| field | value |\n|---|---|\n| consumer | t |\n| budget | 5 commits |\n\n## done-when\n\n| id | command | expect |\n|----|---------|--------|\n| 1 | `true` | exit 0 |\n',
    )
    execFileSync('git', ['-C', feature, 'add', '.dossier'], { stdio: 'ignore' })
    execFileSync('git', ['-C', feature, '-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'contract'], { stdio: 'ignore' })
    const converge = spawnSync('sh', [DS, 'converge'], { cwd: feature, encoding: 'utf8' })
    assert.match(converge.stdout, /contract: .*repo\.feature\/\.dossier\/2026-10-09-w\.md/, converge.stdout + converge.stderr)
    assert.match(converge.stdout, /CONVERGE: MET/)
    const state = spawnSync('sh', [DS, 'convergence-state'], { cwd: main, encoding: 'utf8', input: JSON.stringify({ cwd: main, from: feature }) })
    assert.match(state.stdout, /wave w · 1 criteria/, state.stdout + state.stderr)
    assert.match(state.stdout, /commits: 0 of 5/)
  } finally {
    rmSync(base, { recursive: true, force: true })
  }
})

function wave(root: string, rel: string, token: string, closeout = ''): void {
  const dir = join(root, '.scratchpad', 'dossier', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), `# w\n\n\`2026-10-09\` · \`${token}\` · \`P1/1\`\n\n## Closeout\n\n${closeout}\n`)
}

test('ds-check names a hand-closed archive and a contract with no open wave, and exits 0 on them', () => {
  withRoot((root) => {
    wave(root, '_archive/2026-09-29-handmade', 'done', 'closed by hand')
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier'))
    writeFileSync(join(root, '.dossier', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = spawnSync('sh', [DS, 'ds-check', '.scratchpad'], { cwd: root, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.deepEqual(done.stdout.trim().split('\n'), [
      'advisory: 2026-09-29-handmade is archived with no §Z closure key — `ds close` on it writes one',
      'advisory: .dossier/2026-09-28-proper.md belongs to no open wave — move it to .dossier/_archive/',
    ])
  })
})

test('ds-check prints nothing on a tree whose archives and contracts agree', () => {
  withRoot((root) => {
    wave(root, '_archive/2026-09-28-proper', 'done', 'complete: true')
    wave(root, '2026-10-09-open', 'live')
    mkdirSync(join(root, '.dossier', '_archive'), { recursive: true })
    writeFileSync(join(root, '.dossier', '_archive', '2026-09-28-proper.md'), '# c\n')
    writeFileSync(join(root, '.dossier', '2026-10-09-open.md'), '# c\n')
    const done = spawnSync('sh', [DS, 'ds-check', '.scratchpad'], { cwd: root, encoding: 'utf8' })
    assert.equal(done.status, 0, done.stderr)
    assert.equal(done.stdout, '')
  })
})
