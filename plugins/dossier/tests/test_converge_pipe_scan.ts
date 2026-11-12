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

async function withLedger(body: (root: string, file: string) => Promise<void>): Promise<void> {
  const { dir, clean } = tempRoot('converge-pipe-scan-')
  try {
    const file = join(dir, 'ledger.md')
    writeFileSync(file, '| T1 | . | A |\n')
    await body(dir, file)
  } finally {
    clean()
  }
}

async function refusedBeforeRun(root: string, searches: string[]): Promise<void> {
  const ran = join(root, 'ran')
  for (const search of searches) {
    const result = await converge(root, [`\`touch ${ran}\` | exit 0`, `${search} | exit 1`])
    assert.equal(result.status, 2, `${search}\n${result.stdout}`)
    assert.match(verdict(result), /^CONVERGE: PARSE — criterion 2 .*\[\|\].*grep -e A -e B/, `${search}\n${result.stdout}`)
  }
  assert.ok(!existsSync(ran), 'a command ran before the refusal')
}

test('an escaped pipe inside a regex search pattern is refused before any command runs', async () => {
  await withLedger(async (root, file) => {
    await refusedBeforeRun(root, [
      `\`grep -Eq '^\\| T1 \\| x ' ${file}\``,
      `\`grep -qE "^\\| T1" ${file}\``,
      `\`grep --extended-regexp -q '\\| T1' ${file}\``,
      `\`egrep -q '\\| T1 \\| x' ${file}\``,
      `\`grep -Pq '\\| T1' ${file}\``,
      `\`rg -q '\\| T1 \\| x' ${file}\``,
      `\`grep -c x ${file} \\| grep -Eq '1\\|2'\``,
    ])
  })
})

test('a regex search that does not start its segment is refused too', async () => {
  await withLedger(async (root, file) => {
    await refusedBeforeRun(root, [
      `\`test "$(grep -cE '^\\| T1 \\| x ' ${file})" -eq 1\``,
      `\`LC_ALL=C grep -Eq '\\| T1' ${file}\``,
      `\`command grep -Eq '\\| T1' ${file}\``,
      `\`(grep -Eq '\\| T1' ${file})\``,
      `\`if grep -Eq '\\| T1' ${file}; then exit 0; fi\``,
      `\`git grep --no-index -Eq '\\| T1' ${file}\``,
      `\`! grep -Eq '\\| T1 \\| x ' ${file}\``,
      `\`sh -c 'grep -E x ${file} \\| wc -l'\``,
      `\`rg -q '\\| T1' ${file} \\| awk -F: '{ print }'\``,
    ])
  })
})

test('shell pipes, plain grep pipes, bracketed pipes, rg -F and awk patterns still run', async () => {
  await withLedger(async (root, file) => {
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
        `\`test "$(awk -F'\\|' '{ print $2 }' ${file})" = ' T1 '\` | exit 0`,
        "`printf a \\| sed -E 's/a/b/' \\| grep -q '\\| T1'` | exit 1",
        `\`grep -q 'x\\|y' ${file}; xargs -P 2 true < /dev/null\` | exit 0`,
      ],
      env,
    )
    assert.equal(verdict(result), 'CONVERGE: MET 9/9', result.stdout)
  })
})
