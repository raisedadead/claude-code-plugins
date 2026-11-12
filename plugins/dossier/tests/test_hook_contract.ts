import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { rootRelative } from '../engine/guards.ts'
import { editGate, type Io, ledgerRoot, promptGate, sessionGate, stopGate, verdictGate, verifyGate } from '../hooks/gates.ts'
import { ds, tempRoot } from './inproc.ts'

const CLI = join(import.meta.dirname, '..', 'cli', 'ds')
const SLUG = '2026-06-05-contract'
const LIVE = '`2026-06-05` · `live` · `P1/1`\n\n## §T\n\n| T1 | P1 | . | do thing | — | — |\n\n## §S\n\nstarted\n'
const ISOLATED = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }
const EVAL_GUARD = { id: 'V1', pattern: 'eval\\(', message: 'no eval', paths: ['*.py'] }

type Call = { verb: string; args: string[]; cwd: string; exitCode: number; stdout: string }

let root = ''
let elsewhere = ''
const cleanups: (() => void)[] = []

beforeEach(() => {
  const made = tempRoot('ds-contract-')
  const away = tempRoot('ds-contract-cwd-')
  cleanups.push(made.clean, away.clean)
  root = made.dir
  elsewhere = away.dir
  git('init', '-q')
  mkdirSync(join(root, '.scratchpad', 'dossier', SLUG), { recursive: true })
  writeFileSync(join(root, '.scratchpad', 'dossier', SLUG, 'DOSSIER.md'), LIVE)
})

afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function git(...args: string[]): void {
  execFileSync('git', ['-C', root, ...args], { env: { ...process.env, ...ISOLATED }, stdio: 'ignore' })
}

function realIo(env: Record<string, string> = {}): { io: Io; calls: Call[] } {
  const calls: Call[] = []
  const shared: Record<string, string> = { ...ISOLATED, ...env }
  const io: Io = {
    isDir: async (path) => existsSync(path) && statSync(path).isDirectory(),
    read: async (path) => readFileSync(path, 'utf8'),
    exists: async (path) => existsSync(path),
    list: async (path) => readdirSync(path),
    env: async (name) => shared[name],
    run: async (argv, init) => {
      if (argv[0] === 'git') {
        const done = spawnSync('git', argv.slice(1), { encoding: 'utf8', env: { ...process.env, ...ISOLATED } })
        return { exitCode: done.status ?? 1, stdout: done.stdout, stderr: done.stderr }
      }
      const [shell, cli, verb = '', ...args] = argv
      if (shell !== 'sh' || cli !== CLI) throw new Error(`not a ds call: ${argv.join(' ')}`)
      const cwd = init.cwd ?? elsewhere
      const done = await ds(cwd, [verb, ...args], shared, init.stdin)
      calls.push({ verb, args, cwd, exitCode: done.code, stdout: done.stdout })
      return { exitCode: done.code, stdout: done.stdout, stderr: done.stderr }
    },
    cli: CLI,
  }
  return { io, calls }
}

function shape(calls: Call[]): Omit<Call, 'stdout'>[] {
  return calls.map(({ verb, args, cwd, exitCode }) => ({ verb, args, cwd, exitCode }))
}

function registry(entries: unknown[]): void {
  writeFileSync(join(root, '.scratchpad', 'dossier', '.invariant-guards.json'), JSON.stringify(entries))
}

function seedCache(url: string, data: unknown): void {
  const dir = join(root, '.scratchpad', '.verify-cache')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${createHash('sha1').update(url).digest('hex')}.json`), JSON.stringify({ fetched_at: 9e9, data }))
}

test('invariant-check: an edit on a registered §V pattern comes back as the gate deny text', async () => {
  registry([EVAL_GUARD])
  const { io, calls } = realIo()
  const file = join(root, 'src', 'app.py')
  const verdict = await editGate(io, root, { tool: 'Write', file_path: file, content: 'x = eval(y)\n' })
  assert.deepEqual(shape(calls), [{ verb: 'invariant-check', args: [root], cwd: elsewhere, exitCode: 1 }])
  assert.deepEqual(Object.keys(verdict), ['deny'])
  assert.deepEqual(verdict.deny?.split('\n').slice(0, 3), [`dossier invariant guard: edit to '${file}' violates §V V1.`, '  pattern: eval\\(', '  no eval'])
})

test('invariant-check: an edit off the pattern passes the gate', async () => {
  registry([EVAL_GUARD])
  const { io, calls } = realIo()
  const verdict = await editGate(io, root, { tool: 'Write', file_path: join(root, 'src', 'app.py'), content: 'x = safe(y)\n' })
  assert.deepEqual(shape(calls), [{ verb: 'invariant-check', args: [root], cwd: elsewhere, exitCode: 0 }])
  assert.equal(calls[0]?.stdout, '')
  assert.deepEqual(verdict, {})
})

test('invariant-check: a root-relative guard glob matches the absolute path the edit tools send', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  const { io, calls } = realIo()
  const file = join(root, 'src', 'app.py')
  const verdict = await editGate(io, root, { tool: 'Write', file_path: file, content: 'x = eval(y)\n' })
  assert.deepEqual(shape(calls), [{ verb: 'invariant-check', args: [root], cwd: elsewhere, exitCode: 1 }])
  assert.equal(verdict.deny?.split('\n')[0], `dossier invariant guard: edit to '${file}' violates §V V1.`)
})

async function evalEdit(gateRoot: string, file: string): Promise<{ exitCode?: number; denied: boolean }> {
  const { io, calls } = realIo()
  const verdict = await editGate(io, gateRoot, { tool: 'Write', file_path: file, content: 'x = eval(y)\n' })
  return { exitCode: calls[0]?.exitCode, denied: verdict.deny !== undefined }
}

const DENIED = { exitCode: 1, denied: true }
const PASSED = { exitCode: 0, denied: false }

test('invariant-check: a root-relative guard glob matches a path with a .. segment', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  assert.deepEqual(await evalEdit(root, `${root}/sub/../src/app.py`), DENIED)
})

test('invariant-check: a root-relative guard glob does not match a path in a sibling directory that shares the root prefix', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  assert.deepEqual(await evalEdit(root, `${root}-sibling/src/app.py`), PASSED)
})

test('invariant-check: globs that start with */ or **/ still match the absolute path', async () => {
  registry([{ ...EVAL_GUARD, paths: ['*/src/*.py', '**/*.py'] }])
  assert.deepEqual(await evalEdit(root, join(root, 'src', 'app.py')), DENIED)
  assert.deepEqual(await evalEdit(root, join(root, 'app.py')), DENIED)
})

test('invariant-check: a root-relative guard glob matches a path that reaches the root through a symlink', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  const link = join(elsewhere, 'link')
  symlinkSync(root, link)
  assert.deepEqual(await evalEdit(root, join(link, 'src', 'app.py')), DENIED)
})

test('invariant-check: a root-relative guard glob matches a path under a symlink in the root that points outside it', async () => {
  registry([{ ...EVAL_GUARD, paths: ['lib/*.py'] }])
  const shared = join(elsewhere, 'shared')
  mkdirSync(shared)
  symlinkSync(shared, join(root, 'lib'))
  assert.deepEqual(await evalEdit(root, join(root, 'lib', 'app.py')), DENIED)
})

test('invariant-check: a guard glob that starts with / matches the resolved absolute path', async () => {
  registry([{ ...EVAL_GUARD, paths: [`${root}/src/*.py`] }])
  assert.deepEqual(await evalEdit(root, join(root, 'src', 'app.py')), DENIED)
})

test('invariant-check: a guard glob that starts with / matches when written with the symlinked spelling of the root', async () => {
  const link = join(elsewhere, 'link')
  symlinkSync(root, link)
  registry([{ ...EVAL_GUARD, paths: [`${link}/src/*.py`] }])
  assert.deepEqual(await evalEdit(link, join(link, 'src', 'app.py')), DENIED)
})

test('invariant-check: a root-relative guard glob matches a path whose case differs from the root on a case-insensitive disk', async ({ skip }) => {
  const upper = root.toUpperCase()
  if (upper === root || !existsSync(upper)) skip()
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  assert.deepEqual(await evalEdit(root, join(upper, 'src', 'app.py')), DENIED)
})

test('invariant-check: an edit in a linked worktree matches a root-relative guard glob through the hook root lookup', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'init')
  const tree = join(elsewhere, 'tree')
  git('worktree', 'add', '-q', tree)
  const { io, calls } = realIo()
  const gateRoot = await ledgerRoot(io, tree)
  assert.equal(gateRoot, root)
  const verdict = await editGate(io, gateRoot, { tool: 'Write', file_path: join(tree, 'src', 'app.py'), content: 'x = eval(y)\n' })
  assert.deepEqual(shape(calls), [{ verb: 'invariant-check', args: [root], cwd: elsewhere, exitCode: 1 }])
  assert.deepEqual(Object.keys(verdict), ['deny'])
})

test('invariant-check: an edit from a sub-directory session matches a root-relative guard glob through the hook root lookup', async () => {
  registry([{ ...EVAL_GUARD, paths: ['src/*.py'] }])
  const sub = join(root, 'sub')
  mkdirSync(sub)
  const { io } = realIo()
  const gateRoot = await ledgerRoot(io, sub)
  assert.equal(gateRoot, root)
  assert.deepEqual(await evalEdit(gateRoot, join(root, 'src', 'app.py')), DENIED)
  assert.deepEqual(await evalEdit(gateRoot, join(sub, 'src', 'app.py')), PASSED)
})

test('invariant-check: a filesystem root of / still yields a root-relative path', () => {
  assert.equal(rootRelative('/src/app.py', '/'), 'src/app.py')
})

test('verify-edit: a cached pin hit comes back as the gate advisory and marks the rule fired', async () => {
  seedCache('https://api.github.com/repos/actions/checkout/git/refs/tags/v4', { object: { sha: 'abc1234def' } })
  const { io, calls } = realIo()
  const fired = new Set<string>()
  const file = join(root, '.github', 'workflows', 'ci.yml')
  const text = await verifyGate(io, root, { tool: 'Write', file_path: file, content: 'uses: actions/checkout@v4\n' }, fired)
  assert.deepEqual(shape(calls), [{ verb: 'verify-edit', args: [root], cwd: elsewhere, exitCode: 0 }])
  assert.equal(
    text,
    '⚠ verify[github_action_unpinned] uses: actions/checkout@v4 → uses: actions/checkout@abc1234def  # v4 · src: ' +
      'https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions\n' +
      'silence a rule for this write: `# verify-skip: <ruleName>` anywhere in the content.',
  )
  assert.deepEqual([...fired], ['github_action_unpinned:uses: actions/checkout@v4'])
})

test('session-start: a startup with no title takes the live slug as the session title', async () => {
  const { io, calls } = realIo({ DOSSIER_SESSION_TITLE: '1' })
  const verdict = await sessionGate(io, root, { source: 'startup', session_title: '' })
  assert.deepEqual(shape(calls), [{ verb: 'session-start', args: [], cwd: root, exitCode: 0 }])
  assert.equal(verdict.title, SLUG)
  assert.ok(verdict.context?.includes(SLUG), verdict.context)
})

test('convergence-state: a live wave with no contract comes back as the prompt context', async () => {
  const { io, calls } = realIo()
  const text = await promptGate(io, root)
  assert.deepEqual(shape(calls), [{ verb: 'convergence-state', args: [], cwd: root, exitCode: 0 }])
  assert.equal(text, `wave ${SLUG} · no contract · ds:new writes one, ds:converge reads it`)
})

test('verdict-log: a verdict agent stop lands in the verdict log', async () => {
  const { io, calls } = realIo()
  await verdictGate(io, root, { agent_type: 'whetstone:whetstone-doubter', agent_id: 'a1', last_assistant_message: 'DOUBT: FAILURES\n- x' })
  assert.deepEqual(shape(calls), [{ verb: 'verdict-log', args: [root], cwd: elsewhere, exitCode: 0 }])
  const records = readFileSync(join(root, '.scratchpad', 'dossier', '.verdicts.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  assert.deepEqual(
    records.map(({ agent_type, agent_id, verdicts }) => ({ agent_type, agent_id, verdicts })),
    [{ agent_type: 'whetstone:whetstone-doubter', agent_id: 'a1', verdicts: ['DOUBT: FAILURES'] }],
  )
})

test('fakeimpl: a failing command on a dirty tree comes back as the stop block reason', async () => {
  writeFileSync(join(root, 'a.txt'), 'dirty\n')
  const command = 'echo boom >&2; exit 3'
  const { io, calls } = realIo({ DOSSIER_FAKEIMPL_CMD: command })
  const reason = await stopGate(io, root)
  assert.deepEqual(shape(calls), [{ verb: 'fakeimpl', args: [], cwd: root, exitCode: 0 }])
  assert.equal(reason, `fake-impl backstop: \`${command}\` failed (exit 3) on a dirty tree — the change is not verified:\nboom`)
})
