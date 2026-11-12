import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds as inproc, tempRoot } from './inproc.ts'

const SLUG = '2026-11-12-demo'

type Run = { status: number; stdout: string }

async function ds(root: string, args: string[]): Promise<Run> {
  const done = await inproc(root, args, { DS_CONVERGE_DEPTH: '0' })
  return { status: done.code, stdout: done.stdout }
}

function contract(rows: string[]): string {
  const table = ['| id | command | expect |', '| --- | --- | --- |', ...rows.map((row, i) => `| ${i + 1} | ${row} |`)]
  return ['# c', '', '| field | value |', '| --- | --- |', '| consumer | tests |', '', '## done-when', '', ...table, ''].join('\n')
}

async function withWave(rows: string[], body: (root: string, path: string, status: () => string[]) => Promise<void>, live = true): Promise<void> {
  const { dir: root, clean } = tempRoot('converge-baseline-')
  try {
    const dir = join(root, '.scratchpad', 'dossier', SLUG)
    mkdirSync(dir, { recursive: true })
    mkdirSync(join(root, '.dossier'))
    const ledger = join(dir, 'DOSSIER.md')
    writeFileSync(
      ledger,
      ['# demo', '', `\`2026-11-12\` · \`${live ? 'live' : 'done'}\``, '', '## Status', '', '2026-11-12 09:00 ds:new — DONE', '', '## Closeout', ''].join('\n'),
    )
    const path = join(root, '.dossier', `${SLUG}.md`)
    writeFileSync(path, contract(rows))
    const status = (): string[] =>
      readFileSync(ledger, 'utf8')
        .split('\n')
        .filter((line) => line.includes('ds:converge'))
    await body(root, path, status)
  } finally {
    clean()
  }
}

function last(result: Run, prefix: string): string {
  return result.stdout.split('\n').find((line) => line.startsWith(prefix)) ?? ''
}

test('a row that already passes fails the baseline and is named', async () => {
  await withWave(['`false` | exit 0', '`true` | exit 0'], async (root, path, status) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 1, result.stdout)
    assert.match(last(result, 'BASELINE:'), /^BASELINE: FAIL 2$/, result.stdout)
    assert.equal(status().length, 1, status().join('\n'))
    assert.match(status()[0] ?? '', / ds:converge — baseline FAIL 2$/)
  })
})

test('a guard that fails at baseline fails the baseline', async () => {
  await withWave(['`false` | exit 0', '`false` | exit 0 guard'], async (root, path) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 1, result.stdout)
    assert.match(last(result, 'BASELINE:'), /^BASELINE: FAIL 2 /, result.stdout)
  })
})

test('rows that fail and a passing guard make a clean baseline that lists the guard', async () => {
  await withWave(['`false` | exit 0', '`true` | exit 1', '`true` | exit 0 guard'], async (root, path, status) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 0, result.stdout)
    assert.match(last(result, 'BASELINE:'), /^BASELINE: OK 2 fail; guards 3 /, result.stdout)
    assert.match(status()[0] ?? '', / ds:converge — baseline OK 2 fail; guards 3$/)
  })
})

test('a row whose command did not run fails the baseline', async () => {
  await withWave(['`false` | exit 0', '`sleeep 1` | exit 0'], async (root, path, status) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 1, result.stdout)
    assert.match(last(result, 'BASELINE:'), /^BASELINE: FAIL 2$/, result.stdout)
    assert.match(status()[0] ?? '', / ds:converge — baseline FAIL 2$/)
  })
})

test('a row that runs and exits 1 keeps the baseline clean', async () => {
  await withWave(['`false` | exit 0', '`sh -c "exit 1"` | exit 0'], async (root, path) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 0, result.stdout)
    assert.match(last(result, 'BASELINE:'), /^BASELINE: OK 2 fail; guards none$/, result.stdout)
  })
})

test('a relative contract path still finds the live wave and writes the status line', async () => {
  await withWave(['`false` | exit 0'], async (root, _path, status) => {
    const result = await ds(root, ['converge', '--baseline', `.dossier/${SLUG}.md`])
    assert.equal(result.status, 0, result.stdout)
    assert.match(status()[0] ?? '', / ds:converge — baseline OK 1 fail; guards none$/)
  })
})

test('a normal run judges a guard row by its exit code', async () => {
  await withWave(['`true` | exit 0 guard', '`false` | exit 0 guard'], async (root, path, status) => {
    const result = await ds(root, ['converge', path])
    assert.equal(last(result, 'CONVERGE:'), 'CONVERGE: UNMET 1 of 2', result.stdout)
    assert.match(result.stdout, /^ {2}MET {3}1\. /m, result.stdout)
    assert.deepEqual(status(), [])
  })
})

test('guard has one form, exit 0 guard', async () => {
  await withWave(['`true` | exit 1 guard'], async (root, path) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 2, result.stdout)
  })
})

test('a baseline that cannot parse writes no status line', async () => {
  await withWave(['`false` | stdout: 0'], async (root, path, status) => {
    const result = await ds(root, ['converge', '--baseline', path])
    assert.equal(result.status, 2, result.stdout)
    assert.deepEqual(status(), [])
  })
})

test('a contract no live wave owns gets a verdict and no status line', async () => {
  await withWave(
    ['`false` | exit 0'],
    async (root, path, status) => {
      const result = await ds(root, ['converge', '--baseline', path])
      assert.equal(result.status, 0, result.stdout)
      assert.match(last(result, 'BASELINE:'), /no live wave/, result.stdout)
      assert.deepEqual(status(), [])
    },
    false,
  )
})
