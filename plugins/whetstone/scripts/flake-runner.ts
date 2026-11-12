import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { computeRates, reportLines } from './compute-flakiness.ts'

const USAGE = 'usage: flake-runner <N> <results.json> <cmd...>'

function main(args: string[]): number {
  const [times = '', out = '', command, ...rest] = args
  if (!/^[0-9]+$/.test(times) || !out) {
    process.stderr.write(`flake_runner: ${USAGE}\n`)
    return 1
  }
  if (command === undefined) {
    process.stderr.write('flake_runner: no command given\n')
    return 2
  }
  const runs = Number(times)
  let fails = 0
  for (let at = 0; at < runs; at += 1) {
    if (spawnSync(command, rest, { stdio: 'ignore' }).status !== 0) fails += 1
  }
  const name = process.env.FLAKE_TEST_NAME || 'suite'
  const results = { [name]: { runs, fails } }
  writeFileSync(out, `${JSON.stringify(results)}\n`)
  for (const line of reportLines(computeRates(results))) process.stdout.write(`${line}\n`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
