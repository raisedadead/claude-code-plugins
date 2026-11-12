import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'

const RUNNER = join(import.meta.dirname, '..', 'bin', 'flake-runner')
const COMPUTE = join(import.meta.dirname, '..', 'scripts', 'compute-flakiness-cli.ts')
const tmp = mkdtempSync(join(tmpdir(), 'whet-flake-'))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

function flipper(name: string): string {
  const count = join(tmp, `${name}.count`)
  const path = join(tmp, `${name}.sh`)
  writeFileSync(count, '0')
  writeFileSync(path, `#!/bin/sh\nc=$(cat "${count}"); printf '%s' $((c + 1)) >"${count}"; [ $((c % 2)) -eq 0 ]\n`)
  chmodSync(path, 0o755)
  return path
}

function runner(args: string[], name?: string) {
  const env = name === undefined ? process.env : { ...process.env, FLAKE_TEST_NAME: name }
  return spawnSync(RUNNER, args, { encoding: 'utf8', env })
}

function compute(...args: string[]): number {
  return spawnSync('node', [COMPUTE, ...args], { encoding: 'utf8', cwd: tmp }).status ?? -1
}

function json(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
}

test('results key by FLAKE_TEST_NAME and count runs and fails', () => {
  const out = join(tmp, 'results.json')
  const done = runner(['4', out, flipper('demo')], 'demo')
  assert.equal(done.status, 0, done.stderr)
  assert.deepEqual(json(out), { demo: { runs: 4, fails: 2 } })
})

test('the run prints the rate line for the test', () => {
  const done = runner(['4', join(tmp, 'rate.json'), flipper('rate')], 'demo')
  assert.equal(done.stdout, 'FLAKY 2/4 0.50 demo\n')
})

test('the name defaults to suite', () => {
  const out = join(tmp, 'suite.json')
  assert.equal(runner(['2', out, 'true']).status, 0)
  assert.deepEqual(json(out), { suite: { runs: 2, fails: 0 } })
})

test('no command exits 2', () => {
  const done = runner(['1', join(tmp, 'x.json')])
  assert.equal(done.status, 2)
  assert.equal(done.stderr, 'flake_runner: no command given\n')
})

test('a test id holding a quote or a backslash round-trips as valid JSON', () => {
  const id = 'say "hi" \\ bye'
  const out = join(tmp, 'quoted.json')
  assert.equal(runner(['4', out, flipper('quoted')], id).status, 0)
  assert.deepEqual(Object.keys(json(out)), [id])
})

test('compute-flakiness-cli keeps its exit codes', () => {
  const absent = join(tmp, 'no-baseline.json')
  const q = join(tmp, 'quarantine.json')
  const put = (name: string, text: string): string => {
    writeFileSync(join(tmp, name), text)
    return join(tmp, name)
  }
  const id = 'say "hi" \\ bye'
  const quoted = put('one-quoted.json', `${JSON.stringify({ [id]: { runs: 4, fails: 2 } })}\n`)
  assert.equal(compute(quoted, absent, q), 1)
  assert.deepEqual(Object.keys(json(q)), [id])
  rmSync(q, { force: true })
  assert.equal(compute(join(tmp, 'missing.json'), absent, q), 252)
  assert.equal(existsSync(q), false)
  assert.equal(compute(put('corrupt.json', 'not json at all\n'), absent, q), 252)
  assert.equal(compute(put('malformed.json', '{"a": 5}\n'), absent, q), 252)
  assert.equal(compute(quoted, put('bad-baseline.json', 'not json at all\n'), q), 252)
  assert.equal(compute(), 251)
  assert.equal(compute(quoted, absent, join(tmp, 'no-such-dir', 'q.json')), 253)
  assert.equal(compute(put('two.json', '{"a": {"runs": 5, "fails": 2}, "b": {"runs": 5, "fails": 3}}\n'), absent, q), 2)
  assert.equal(compute(put('clean.json', '{"a": {"runs": 5, "fails": 0}, "b": {"runs": 5, "fails": 5}}\n'), absent, q), 0)
  assert.equal(readFileSync(q, 'utf8').trim(), '{}')
  const one = put('one.json', '{"a": {"runs": 5, "fails": 2}}\n')
  assert.equal(compute(one, put('baseline.json', '{"a": 0.4}\n'), q), 0)
})
