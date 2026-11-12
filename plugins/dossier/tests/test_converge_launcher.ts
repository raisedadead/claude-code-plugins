import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { promisify } from 'node:util'
import { test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const execFileAsync = promisify(execFile)

const PLUGIN = join(import.meta.dirname, '..')
const DS = join(PLUGIN, 'cli', 'ds')
const DS_ENTRY = join(PLUGIN, 'cli', 'ds.ts')
const FIXTURES = join(PLUGIN, 'tests', 'fixtures')
const REPO = join(PLUGIN, '..', '..')

const UNMET = 1
const PARSE = 2

type Run = { status: number; stdout: string; stderr: string }

type Options = { cwd?: string; env?: NodeJS.ProcessEnv }

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

async function converge(cwd: string, args: string[]): Promise<Run> {
  const done = await ds(cwd, ['converge', ...args], { DS_CONVERGE_DEPTH: '0' })
  return { status: done.code, stdout: done.stdout, stderr: done.stderr }
}

function run(contract: string): Promise<Run> {
  return converge(REPO, [contract])
}

function out(result: Run): string {
  return result.stdout + result.stderr
}

function verdict(result: Run): string {
  return result.stdout.split('\n').find((line) => line.startsWith('CONVERGE:')) ?? ''
}

async function withFixture(name: string, text: (path: string) => string, body: (path: string) => Promise<void>): Promise<void> {
  const { dir, clean } = tempRoot('converge-fixture-')
  const path = join(dir, name)
  writeFileSync(path, text(path))
  try {
    await body(path)
  } finally {
    clean()
  }
}

function singleCriterion(header: string, rule: string, row: string): string {
  return '# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n' + '## done-when\n\n' + `${header}\n${rule}\n${row}\n`
}

test('the plan block reaches a pipe while the run is still going', async () => {
  const root = mkdtempSync(join(tmpdir(), 'converge-'))
  try {
    const contract = join(root, 'slow.md')
    const go = join(root, 'go')
    const done = join(root, 'done')
    const wait = `sh -c 'i=0; while [ ! -f ${go} ] && [ $i -lt 200 ]; do sleep 0.05; i=$((i+1)); done; touch ${done}'`
    writeFileSync(contract, singleCriterion('| id | command | expect |', '| --- | --- | --- |', `| 1 | \`${wait}\` | exit 0 |`))
    const child = spawn('sh', [DS, 'converge', contract], { cwd: REPO, env: cleanEnv(), stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    const exited = new Promise((resolve) => child.on('close', resolve))
    let running: boolean | undefined
    const lines = createInterface({ input: child.stdout })
    for await (const line of lines) {
      if (line.startsWith('will run ')) {
        running = !existsSync(done)
        break
      }
    }
    writeFileSync(go, '')
    lines.close()
    child.stdout.destroy()
    const code = await exited
    assert.ok(running !== undefined, 'no will-run line')
    assert.ok(running, 'the plan block arrived only after the criterion finished')
    assert.equal(stderr, '')
    assert.equal(code, 141)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
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

test('a self-referencing contract terminates', async () => {
  const text = (path: string): string =>
    '# loop\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n' +
    '## done-when\n\n' +
    '| id  | command | expect |\n' +
    '| --- | ------- | ------ |\n' +
    `| 1   | \`echo x >> ${dirname(path)}/hits; sh plugins/dossier/cli/ds converge ${path}\` | exit 0 |\n`
  await withFixture('loop.md', text, async (loop) => {
    const result = await converge(REPO, [loop])
    assert.ok(result.status === UNMET || result.status === PARSE, out(result))
    assert.equal(readFileSync(join(dirname(loop), 'hits'), 'utf8'), 'x\nx\n', out(result))
  })
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
  const [direct, viashell] = await Promise.all([
    exec(process.execPath, [DS_ENTRY, 'converge', join(FIXTURES, 'met.md')], { cwd: REPO, env: cleanEnv() }),
    exec('sh', [DS, 'converge', join(FIXTURES, 'met.md')], { cwd: REPO, env: cleanEnv() }),
  ])
  assert.equal(viashell.status, direct.status, out(viashell))
})
