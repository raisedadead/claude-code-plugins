import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

type Run = { status: number; stdout: string }

async function converge(root: string, rows: string[], env: Readonly<Record<string, string>> = {}): Promise<Run> {
  const contract = join(root, 'contract.md')
  const table = ['| id | command | expect |', '| --- | --- | --- |', ...rows.map((row, i) => `| ${i + 1} | ${row} |`)]
  writeFileSync(contract, ['# c', '', '| field | value |', '| --- | --- |', '| consumer | tests |', '', '## done-when', '', ...table, ''].join('\n'))
  const done = await ds(root, ['converge', contract], { DS_CONVERGE_DEPTH: '0', ...env })
  return { status: done.code, stdout: done.stdout }
}

function verdict(result: Run): string {
  return result.stdout.split('\n').find((line) => line.startsWith('CONVERGE:')) ?? ''
}

async function withTmp(body: (root: string) => Promise<void>): Promise<void> {
  const { dir, clean } = tempRoot('converge-one-form-')
  try {
    await body(dir)
  } finally {
    clean()
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

function ledger(root: string): string {
  const path = join(root, 'ledger.md')
  writeFileSync(path, '| T1 | . | A |\n')
  return path
}

test('an escaped pipe inside a regex search pattern is refused before any command runs', async () => {
  await withTmp(async (root) => {
    const file = ledger(root)
    const ran = join(root, 'ran')
    const searches = [
      `\`grep -Eq '^\\| T1 \\| x ' ${file}\``,
      `\`grep -qE "^\\| T1" ${file}\``,
      `\`grep --extended-regexp -q '\\| T1' ${file}\``,
      `\`egrep -q '\\| T1 \\| x' ${file}\``,
      `\`grep -Pq '\\| T1' ${file}\``,
      `\`rg -q '\\| T1 \\| x' ${file}\``,
      `\`grep -c x ${file} \\| grep -Eq '1\\|2'\``,
    ]
    for (const search of searches) {
      const result = await converge(root, [`\`touch ${ran}\` | exit 0`, `${search} | exit 1`])
      assert.equal(result.status, 2, `${search}\n${result.stdout}`)
      assert.match(verdict(result), /^CONVERGE: PARSE — criterion 2 .*\[\|\]/, result.stdout)
    }
    assert.ok(!existsSync(ran), 'a command ran before the refusal')
  })
})

test('shell pipes, sh -c pipes, bracketed pipes and plain grep patterns still run', async () => {
  await withTmp(async (root) => {
    const file = ledger(root)
    const bin = join(root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(bin, 'rg'), '#!/bin/sh\nexec grep "$@"\n', { mode: 0o755 })
    const env = { PATH: `${bin}:${process.env.PATH ?? ''}` }
    const result = await converge(
      root,
      [
        "`printf 'a' \\| grep -q a` | exit 0",
        "`sh -c 'printf a \\| grep -q a'` | exit 0",
        `\`grep -Eq '^[\\|] T1 [\\|] x ' ${file}\` | exit 1`,
        `\`grep -Eq '^[\\|] T1 [\\|] [.] ' ${file}\` | exit 0`,
        `\`grep -q '^\\| T1 \\| x ' ${file}\` | exit 1`,
        `\`rg -qF '\\| T1 \\|' ${file}\` | exit 0`,
      ],
      env,
    )
    assert.equal(verdict(result), 'CONVERGE: MET 6/6', result.stdout)
  })
})

test('exit expects still run and judge by exit code', async () => {
  await withTmp(async (root) => {
    const result = await converge(root, ['`true` | exit 0', '`false` | exit 1', '`sh -c "exit 3"` | exit 3'])
    assert.equal(verdict(result), 'CONVERGE: MET 3/3', result.stdout)
    assert.equal(result.status, 0, result.stdout)
  })
})
