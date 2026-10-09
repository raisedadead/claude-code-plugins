import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { test as base } from 'vitest'

const test = base.concurrent
const execFileAsync = promisify(execFile)

const PLUGIN = join(import.meta.dirname, '..')
const DS = join(PLUGIN, 'cli', 'ds')
const DS_ENTRY = join(PLUGIN, 'cli', 'ds.ts')
const FIXTURES = join(PLUGIN, 'tests', 'fixtures')
const REPO = join(PLUGIN, '..', '..')

const MET = 0
const UNMET = 1
const PARSE = 2

type Run = { status: number; stdout: string; stderr: string }

type Options = { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.DS_CONVERGE_DEPTH
  return env
}

async function exec(file: string, args: string[], options: Options): Promise<Run> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { ...options, encoding: 'utf8' })
    return { status: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    if (typeof failed.code !== 'number') throw error
    return { status: failed.code, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' }
  }
}

function pipeInto(file: string, args: string[], input: string, options: Options): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.stdin.on('error', () => {})
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === null) reject(new Error(`${file} ${args.join(' ')} was killed`))
      else resolve({ status: code, stdout, stderr })
    })
    child.stdin.end(input)
  })
}

function converge(cwd: string, args: string[], env: NodeJS.ProcessEnv = cleanEnv(), timeout?: number): Promise<Run> {
  return exec('sh', [DS, 'converge', ...args], { cwd, env, timeout })
}

function run(contract: string): Promise<Run> {
  return converge(REPO, [contract])
}

function runNoArg(root: string): Promise<Run> {
  return converge(root, [])
}

function out(result: Run): string {
  return result.stdout + result.stderr
}

function verdict(result: Run): string {
  return result.stdout.split('\n').find((line) => line.startsWith('CONVERGE:')) ?? ''
}

async function withTmp(body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'converge-'))
  try {
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

async function withFixture(name: string, text: (path: string) => string, body: (path: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'converge-fixture-'))
  const path = join(dir, name)
  writeFileSync(path, text(path))
  try {
    await body(path)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function wave(root: string, dirname: string, state = 'live', goal = ''): string {
  const dir = join(root, '.scratchpad', 'dossier', dirname)
  mkdirSync(dir, { recursive: true })
  const ledger = [`# ${dirname.slice(11)}`, '', `\`2026-08-01\` · \`${state}\` · \`P1/1\``, '', '## Goal', '', goal, '']
  writeFileSync(join(dir, 'DOSSIER.md'), ledger.join('\n'))
  return dir
}

function contractText(criterion = '`true`  | exit 0'): string {
  return (
    '# c\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    `| 1   | ${criterion} |\n`
  )
}

function tracked(root: string, name: string, text = contractText()): void {
  mkdirSync(join(root, '.dossier'), { recursive: true })
  writeFileSync(join(root, '.dossier', name), text)
}

function singleCriterion(header: string, rule: string, row: string): string {
  return '# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n' + '## done-when\n\n' + `${header}\n${rule}\n${row}\n`
}

async function runText(name: string, text: string): Promise<Run> {
  let result: Run | undefined
  await withTmp(async (root) => {
    const contract = join(root, name)
    writeFileSync(contract, text)
    result = await run(contract)
  })
  assert.ok(result)
  return result
}

function malformed(row: string): Promise<Run> {
  const text =
    '# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    '| 1   | `true`  | exit 0 |\n' +
    row
  return runText('malformed.md', text)
}

test('the plan block reaches a pipe while the run is still going', async () => {
  const root = mkdtempSync(join(tmpdir(), 'converge-'))
  try {
    const contract = join(root, 'slow.md')
    writeFileSync(
      contract,
      singleCriterion('| id  | command           | expect |', '| --- | ----------------- | ------ |', "| 1   | `sh -c 'sleep 4'` | exit 0 |"),
    )
    const started = performance.now()
    const child = spawn('sh', [DS, 'converge', contract], { cwd: REPO, env: cleanEnv(), stdio: ['ignore', 'pipe', 'inherit'] })
    const exited = new Promise((resolve) => child.on('close', resolve))
    let planned: number | undefined
    const lines = createInterface({ input: child.stdout })
    for await (const line of lines) {
      if (line.startsWith('will run ')) {
        planned = (performance.now() - started) / 1000
        break
      }
    }
    lines.close()
    child.stdout.destroy()
    await exited
    assert.ok(planned !== undefined, 'no will-run line')
    assert.ok(planned < 2.0, `plan block arrived after ${planned.toFixed(2)}s`)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('all criteria met exits zero', async () => {
  const result = await run(join(FIXTURES, 'met.md'))
  assert.equal(verdict(result), 'CONVERGE: MET 5/5', out(result))
  assert.equal(result.status, MET, out(result))
})

test('any criterion unmet exits one', async () => {
  const result = await run(join(FIXTURES, 'unmet.md'))
  assert.equal(verdict(result), 'CONVERGE: UNMET 2 of 3', out(result))
  assert.equal(result.status, UNMET, out(result))
})

test('exit code follows criteria not their count', async () => {
  const met = await run(join(FIXTURES, 'met.md'))
  const unmet = await run(join(FIXTURES, 'unmet.md'))
  assert.equal(met.status, MET, met.stdout)
  assert.equal(unmet.status, UNMET, unmet.stdout)
})

test('one line reported per criterion', async () => {
  const result = await run(join(FIXTURES, 'met.md'))
  const reported = result.stdout.split('\n').filter((line) => line.startsWith('  '))
  assert.equal(reported.length, 5, result.stdout)
})

test('a non-command criterion fails the parse', async () => {
  const result = await run(join(FIXTURES, 'prose.md'))
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), out(result))
  assert.equal(result.status, PARSE, out(result))
})

test('a contract without a done-when table fails the parse', async () => {
  const result = await run(join(PLUGIN, 'tests', 'test_converge.ts'))
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), out(result))
  assert.equal(result.status, PARSE, out(result))
})

test('a missing contract fails the parse', async () => {
  const result = await run(join(FIXTURES, 'no-such-contract.md'))
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), out(result))
  assert.equal(result.status, PARSE, out(result))
})

test('an escaped pipe survives the cell split', async () => {
  const result = await run(join(FIXTURES, 'met.md'))
  assert.equal(result.status, MET, out(result))
  assert.ok(result.stdout.includes('| cat'), result.stdout)
})

test('a nonzero expected exit counts as met', async () => {
  const result = await run(join(FIXTURES, 'met.md'))
  assert.ok(result.stdout.includes('false'), result.stdout)
  assert.equal(result.status, MET, result.stdout)
})

test('stdout nothing requires empty output', async () => {
  const result = await run(join(FIXTURES, 'unmet.md'))
  assert.equal(result.status, UNMET, result.stdout)
  assert.ok(result.stdout.includes('nope') || result.stdout.includes('yes'), result.stdout)
})

test('a criterion pointed at another contract is allowed', async () => {
  const text =
    '# sibling\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    '| 1   | `sh plugins/dossier/cli/ds converge plugins/dossier/tests/fixtures/met.md` | exit 0 |\n'
  await withFixture(
    'sibling.md',
    () => text,
    async (sibling) => {
      const result = await run(sibling)
      assert.equal(verdict(result), 'CONVERGE: MET 1/1', out(result))
    },
  )
})

test('a name containing the runner is not the runner', async () => {
  const text =
    '# lookalike\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    '| 1   | `test -f plugins/dossier/tests/test_converge.ts` | exit 0 |\n'
  await withFixture(
    'lookalike.md',
    () => text,
    async (lookalike) => {
      const result = await run(lookalike)
      assert.equal(verdict(result), 'CONVERGE: MET 1/1', out(result))
    },
  )
})

test('a self-referencing contract terminates', async () => {
  const text = (path: string): string =>
    '# loop\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    `| 1   | \`sh plugins/dossier/cli/ds converge ${path}\` | exit 0 |\n`
  await withFixture('loop.md', text, async (loop) => {
    const result = await converge(REPO, [loop], cleanEnv(), 60_000)
    assert.ok(result.status === UNMET || result.status === PARSE, out(result))
  })
})

test('nesting past the cap is refused', async () => {
  const result = await converge(REPO, [join(FIXTURES, 'met.md')], { ...cleanEnv(), DS_CONVERGE_DEPTH: '2' })
  assert.ok(result.stdout.includes('refusing to recurse'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('one level of nesting is allowed', async () => {
  const text =
    '# nested\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    '| 1   | `sh plugins/dossier/cli/ds converge plugins/dossier/tests/fixtures/met.md` | exit 0 |\n'
  await withFixture(
    'nested.md',
    () => text,
    async (nested) => {
      const result = await run(nested)
      assert.equal(verdict(result), 'CONVERGE: MET 1/1', out(result))
    },
  )
})

test('the shell wrapper agrees with the module', async () => {
  const direct = await exec(process.execPath, [DS_ENTRY, 'converge', join(FIXTURES, 'met.md')], { cwd: REPO, env: cleanEnv() })
  const viashell = await run(join(FIXTURES, 'met.md'))
  assert.equal(viashell.status, direct.status, out(viashell))
})

test('the default contract is the live wave not the last sorted', async () => {
  await withTmp(async (root) => {
    const body = (slug: string) =>
      `# ${slug}\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n` +
      '## done-when\n\n' +
      '| id  | command | expect |\n' +
      '| --- | ------- | ------ |\n' +
      '| 1   | `true`  | exit 0 |\n'
    tracked(root, '2026-08-01-aaa-live.md', body('aaa-live'))
    tracked(root, '2026-08-01-zzz-closed.md', body('zzz-closed'))
    const dir = join(root, '.scratchpad', 'dossier', '2026-08-01-aaa-live')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'DOSSIER.md'), ['# aaa-live', '', '`2026-08-01` · `live` · `P1/1`', ''].join('\n'))
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('aaa-live'), result.stdout)
    assert.ok(!result.stdout.includes('zzz-closed'), result.stdout)
  })
})

test('a wave dir contract is found without a dossier dir', async () => {
  await withTmp(async (root) => {
    const dir = wave(root, '2026-08-01-solo')
    writeFileSync(join(dir, 'CONTRACT.md'), contractText())
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), out(result))
  })
})

test('the tracked contract wins over the wave dir copy', async () => {
  await withTmp(async (root) => {
    const dir = wave(root, '2026-08-01-solo')
    writeFileSync(join(dir, 'CONTRACT.md'), contractText('`false` | exit 0'))
    tracked(root, '2026-08-01-solo.md')
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), result.stdout)
  })
})

test('no live wave yields parse not a closed contract', async () => {
  await withTmp(async (root) => {
    tracked(root, '2026-08-01-done.md')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.ok(verdict(result).includes('live wave'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a live wave without a contract is a parse', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-01-bare')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.ok(verdict(result).includes('2026-08-01-bare'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a paused wave whose prose says live is not live', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails', 'paused', 'Get the `live` count right.')
    tracked(root, '2026-08-05-rails.md')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.ok(verdict(result).includes('live wave'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a live wave whose prose says paused still converges', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails', 'live', 'Stop reading `paused` as prose.')
    tracked(root, '2026-08-05-rails.md')
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), out(result))
    assert.equal(result.status, MET, result.stdout)
  })
})

test('a same-slug successor selects the live wave', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails')
    tracked(root, '2026-08-01-rails.md', contractText('`false` | exit 0'))
    tracked(root, '2026-08-05-rails.md')
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('2026-08-05-rails'), result.stdout)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), result.stdout)
  })
})

test('two live waves with contracts is a parse naming both', async () => {
  await withTmp(async (root) => {
    for (const slug of ['2026-08-01-older', '2026-08-05-newer']) {
      writeFileSync(join(wave(root, slug), 'CONTRACT.md'), contractText())
    }
    const result = await runNoArg(root)
    const line = verdict(result)
    assert.ok(line.startsWith('CONVERGE: PARSE'), result.stdout)
    assert.ok(line.includes('2026-08-01-older') && line.includes('2026-08-05-newer'), line)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('one live wave beside a contractless live wave still converges', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-01-bare')
    writeFileSync(join(wave(root, '2026-08-05-solo'), 'CONTRACT.md'), contractText())
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), out(result))
    assert.equal(result.status, MET, result.stdout)
  })
})

test('a single-char stem does not match an unrelated wave', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails')
    tracked(root, 's.md')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a shared suffix does not match across slugs', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-guardrails')
    tracked(root, 'rails.md')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('an undated contract name still matches its own wave', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails')
    tracked(root, 'rails.md')
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), result.stdout)
  })
})

test('an archived contract is not resolved', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-05-rails')
    const archive = join(root, '.dossier', '_archive')
    mkdirSync(archive, { recursive: true })
    writeFileSync(join(archive, '2026-08-05-rails.md'), contractText())
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a contract without a consumer fails the parse', async () => {
  const result = await runText('no-consumer.md', '# c\n\n## done-when\n\n| id  | command | expect |\n| --- | ------- | ------ |\n| 1   | `true`  | exit 0 |\n')
  const line = verdict(result)
  assert.ok(line.startsWith('CONVERGE: PARSE'), out(result))
  assert.ok(line.includes('consumer'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('a consumer row with an empty value fails the parse', async () => {
  const result = await runText(
    'blank-consumer.md',
    '# c\n\n| field    | value |\n| -------- | ----- |\n| consumer |       |\n\n' +
      '## done-when\n\n| id  | command | expect |\n| --- | ------- | ------ |\n| 1   | `true`  | exit 0 |\n',
  )
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('an empty stdout expect fails the parse', async () => {
  const result = await runText(
    'empty-expect.md',
    singleCriterion('| id  | command              | expect  |', '| --- | -------------------- | ------- |', '| 1   | `echo totally-wrong` | stdout: |'),
  )
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('a numbered row missing a cell fails the parse', async () => {
  const result = await malformed('| 2   | `false` |\n')
  const line = verdict(result)
  assert.ok(line.startsWith('CONVERGE: PARSE'), out(result))
  assert.ok(line.includes('2'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('a numbered row with an extra cell fails the parse', async () => {
  const result = await malformed('| 2   | `echo a | cat` | exit 0 |\n')
  assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
  assert.ok(verdict(result).includes('not exactly id | command | expect'), result.stdout)
  assert.equal(result.status, PARSE, result.stdout)
})

test('the prompt hook counts the rows this runner refuses', async () => {
  const { numberedRows } = await import('../engine/converge.ts')
  const text =
    '# c\n\n## done-when\n\n' + '| id  | command | expect |\n' + '| --- | ------- | ------ |\n' + '| 1   | `true`  | exit 0 |\n' + '| 2   | `false` |\n'
  assert.equal(numberedRows(text).length, 2)
  await withTmp(async (root) => {
    writeFileSync(join(wave(root, '2026-08-01-c'), 'CONTRACT.md'), text)
    const state = await pipeInto('sh', [DS, 'convergence-state'], JSON.stringify({ cwd: root }), { env: cleanEnv() })
    assert.ok(state.stdout.includes('2 criteria'), state.stdout + state.stderr)
  })
})

test('a matching substring with a failed command is unmet', async () => {
  const result = await runText(
    'loud-failure.md',
    singleCriterion(
      '| id  | command                        | expect        |',
      '| --- | ----------------------------- | ------------- |',
      "| 1   | `sh -c 'echo hello; exit 3'`  | stdout: hello |",
    ),
  )
  assert.equal(verdict(result), 'CONVERGE: UNMET 1 of 1', result.stdout)
  assert.equal(result.status, UNMET, result.stdout)
})

test('stdout nothing with a failed command is unmet', async () => {
  const result = await runText(
    'silent-failure.md',
    singleCriterion(
      '| id  | command        | expect            |',
      '| --- | -------------- | ----------------- |',
      "| 1   | `sh -c 'exit 3'` | stdout: (nothing) |",
    ),
  )
  assert.equal(verdict(result), 'CONVERGE: UNMET 1 of 1', result.stdout)
  assert.equal(result.status, UNMET, result.stdout)
})

test('every command is named before the first one runs', async () => {
  const result = await run(join(FIXTURES, 'met.md'))
  const lines = result.stdout.split('\n')
  const planned = lines.flatMap((line, i) => (line.startsWith('will run ') ? [i] : []))
  const ran = lines.flatMap((line, i) => (line.startsWith('  MET') || line.startsWith('  UNMET') ? [i] : []))
  assert.equal(planned.length, 5, result.stdout)
  assert.equal(ran.length, 5, result.stdout)
  assert.ok(Math.max(...planned) < Math.min(...ran), result.stdout)
})

test('stderr does not satisfy a stdout expect', async () => {
  const result = await run(join(FIXTURES, 'stderr-only.md'))
  assert.equal(verdict(result), 'CONVERGE: UNMET 1 of 1', out(result))
  assert.equal(result.status, UNMET, out(result))
})

test('stdout nothing ignores a noisy stderr', async () => {
  const result = await runText(
    'noisy-but-silent.md',
    singleCriterion(
      '| id  | command                   | expect            |',
      '| --- | ------------------------- | ----------------- |',
      "| 1   | `sh -c 'echo noise >&2'`  | stdout: (nothing) |",
    ),
  )
  assert.equal(verdict(result), 'CONVERGE: MET 1/1', out(result))
  assert.equal(result.status, MET, out(result))
})

test('a failed criterion reports its stderr', async () => {
  const result = await runText(
    'diagnostic.md',
    singleCriterion(
      '| id  | command                       | expect |',
      '| --- | ----------------------------- | ------ |',
      '| 1   | `cat /nonexistent-xyz-marker` | exit 0 |',
    ),
  )
  const reported = result.stdout.split('\n').filter((line) => line.startsWith('  UNMET'))
  assert.equal(reported.length, 1, result.stdout)
  assert.ok(reported[0]?.includes('No such file'), result.stdout)
})

test('a hyphen boundary does not match across slugs', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-01-claim-check')
    tracked(root, 'check.md')
    const result = await runNoArg(root)
    assert.ok(verdict(result).startsWith('CONVERGE: PARSE'), result.stdout)
    assert.equal(result.status, PARSE, result.stdout)
  })
})

test('a date-stripped name still matches its own wave', async () => {
  await withTmp(async (root) => {
    wave(root, '2026-08-01-claim-check')
    tracked(root, 'claim-check.md')
    const result = await runNoArg(root)
    assert.ok(result.stdout.includes('CONVERGE: MET 1/1'), result.stdout)
  })
})
