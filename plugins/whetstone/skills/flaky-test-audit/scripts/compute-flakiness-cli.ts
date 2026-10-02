import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { computeRates, InputError, newFlags, quarantine, reportLines } from './compute-flakiness.ts'
import { byCodePoint } from '../../../hooks/text.ts'

const EXIT_USAGE = 251
const EXIT_BAD_INPUT = 252
const EXIT_NO_ARTIFACT = 253
const MAX_COUNT = 250

function load(path: string, missingOk = false): Record<string, unknown> {
  if (missingOk && path !== '' && !existsSync(path)) return {}
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (error) {
    throw new InputError(`${path}: unreadable (${(error as { code?: string }).code})`)
  }
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (error) {
    throw new InputError(`${path}: not JSON (${(error as Error).message})`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new InputError(`${path}: top level is ${Array.isArray(data) ? 'list' : String(data)}, want an object`)
  }
  return data as Record<string, unknown>
}

function sortedJson(record: Record<string, number>): string {
  const sorted = Object.fromEntries(Object.keys(record).sort(byCodePoint).map((key) => [key, record[key]]))
  return JSON.stringify(sorted, null, 2) + '\n'
}

function main(args: string[]): number {
  const [resultsPath, baselinePath, outPath = 'quarantine.json'] = args
  if (resultsPath === undefined) {
    console.error('usage: compute-flakiness <results.json> [baseline-quarantine.json] [out-quarantine.json]')
    return EXIT_USAGE
  }
  let rates
  let baseline
  try {
    const results = load(resultsPath)
    baseline = baselinePath === undefined ? {} : load(baselinePath, true)
    rates = computeRates(results)
  } catch (error) {
    if (!(error instanceof InputError)) throw error
    console.error(`compute-flakiness: ${error.message}`)
    return EXIT_BAD_INPUT
  }
  const quarantined = quarantine(rates)
  for (const line of reportLines(rates)) console.log(line)
  try {
    writeFileSync(outPath, sortedJson(quarantined))
  } catch (error) {
    console.error(`compute-flakiness: ${outPath}: ${(error as { code?: string }).code}`)
    return EXIT_NO_ARTIFACT
  }
  const fresh = newFlags(quarantined, baseline)
  for (const test of fresh) console.error(`NEW-FLAKY ${test}`)
  return Math.min(fresh.length, MAX_COUNT)
}

process.exitCode = main(process.argv.slice(2))
