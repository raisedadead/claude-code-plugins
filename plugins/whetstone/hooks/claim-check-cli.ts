import { readFileSync, statSync } from 'node:fs'
import { flaggedVerdict, scanText } from './claim-check.ts'

const CLEAN = 0
const FLAGGED = 1
const USAGE = 64

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function report(flagged: string[], clean: string): number {
  for (const entry of flagged) console.log(entry)
  if (flagged.length) {
    console.log(flaggedVerdict(flagged.length))
    return FLAGGED
  }
  console.log(`CLAIMS: CLEAN ${clean}`)
  return CLEAN
}

function main(args: string[]): number {
  const readStdin = args.includes('--stdin')
  const options = args.filter((a) => a.startsWith('-') && a !== '--stdin')
  if (options.length) {
    for (const option of options) console.error(`claim-check: unknown option: ${option}`)
    return USAGE
  }
  const paths = args.filter((a) => !a.startsWith('-'))
  if (readStdin) {
    if (paths.length) {
      console.error('claim-check: --stdin takes no paths')
      return USAGE
    }
    return report(scanText(readFileSync(0, 'utf8'), '<stdin>'), 'stdin')
  }
  if (!paths.length) {
    console.error('claim-check: usage: claim-check --stdin | <path>...')
    return USAGE
  }
  const missing = paths.filter((p) => !isFile(p))
  if (missing.length) {
    for (const p of missing) console.error(`claim-check: no such file: ${p}`)
    return USAGE
  }
  const flagged = paths.flatMap((p) => scanText(readFileSync(p, 'utf8'), p))
  return report(flagged, `${paths.length} file${paths.length === 1 ? '' : 's'}`)
}

process.exitCode = main(process.argv.slice(2))
