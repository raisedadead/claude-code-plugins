import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test as base } from 'vitest'

const test = base.concurrent
const execFileAsync = promisify(execFile)

const PLUGIN = join(import.meta.dirname, '..')
const DS = join(PLUGIN, 'cli', 'ds')

type Run = { status: number; stdout: string }

function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env }
  delete env.DS_CONVERGE_DEPTH
  return env
}

async function converge(root: string, rows: string[]): Promise<Run> {
  const contract = join(root, 'contract.md')
  const table = ['| id | command | expect |', '| --- | --- | --- |', ...rows.map((row, i) => `| ${i + 1} | ${row} |`)]
  writeFileSync(contract, ['# c', '', '| field | value |', '| --- | --- |', '| consumer | tests |', '', '## done-when', '', ...table, ''].join('\n'))
  try {
    const { stdout } = await execFileAsync('sh', [DS, 'converge', contract], { cwd: root, env: cleanEnv(), encoding: 'utf8' })
    return { status: 0, stdout }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string }
    if (typeof failed.code !== 'number') throw error
    return { status: failed.code, stdout: failed.stdout ?? '' }
  }
}

function verdict(result: Run): string {
  return result.stdout.split('\n').find((line) => line.startsWith('CONVERGE:')) ?? ''
}

async function withTmp(body: (root: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'converge-one-form-'))
  try {
    await body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function lines(root: string, name: string, count: number): string {
  const path = join(root, name)
  writeFileSync(path, 'x\n'.repeat(count))
  return path
}

test('a stdout expect is refused before any command runs', async () => {
  await withTmp(async (root) => {
    const ran = join(root, 'ran')
    const result = await converge(root, [`\`touch ${ran}\` | exit 0`, '`wc -l < /dev/null` | stdout: 0'])
    assert.equal(result.status, 2, result.stdout)
    assert.match(verdict(result), /^CONVERGE: PARSE — criterion 2 /, result.stdout)
    assert.ok(!existsSync(ran), 'a command ran before the refusal')
  })
})

test('a stdout nothing expect is refused', async () => {
  await withTmp(async (root) => {
    const result = await converge(root, ['`printf ""` | stdout: (nothing)'])
    assert.equal(result.status, 2, result.stdout)
    assert.match(verdict(result), /^CONVERGE: PARSE — criterion 1 /, result.stdout)
  })
})

test('the rewrite the refusal names runs as an exit 0 check', async () => {
  await withTmp(async (root) => {
    const refused = verdict(await converge(root, ['`wc -l < /dev/null` | stdout: 0']))
    const forms = [...refused.matchAll(/`([^`]*cmd[^`]*)`/g)].map((found) => found[1] ?? '')
    assert.equal(forms.length, 2, refused)
    const three = lines(root, 'three.txt', 3)
    const count = forms.find((form) => form.includes(' N'))
    const empty = forms.find((form) => !form.includes(' N'))
    assert.ok(count && empty, refused)
    const met = await converge(root, [
      `\`${count.replace('cmd', `wc -l < ${three}`).replace(' N', ' 3')}\` | exit 0`,
      `\`${empty.replace('cmd', 'printf ""')}\` | exit 0`,
    ])
    assert.equal(verdict(met), 'CONVERGE: MET 2/2', met.stdout)
  })
})

test('a count of 120 does not meet a check for 0', async () => {
  await withTmp(async (root) => {
    const many = lines(root, 'many.txt', 120)
    const result = await converge(root, [`\`test "$(wc -l < ${many})" -eq 0\` | exit 0`])
    assert.equal(verdict(result), 'CONVERGE: UNMET 1 of 1', result.stdout)
  })
})

test('exit expects still run and judge by exit code', async () => {
  await withTmp(async (root) => {
    const result = await converge(root, ['`true` | exit 0', '`false` | exit 1', '`sh -c "exit 3"` | exit 3'])
    assert.equal(verdict(result), 'CONVERGE: MET 3/3', result.stdout)
    assert.equal(result.status, 0, result.stdout)
  })
})
