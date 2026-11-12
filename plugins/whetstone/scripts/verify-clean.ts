import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKER = /^(<<<<<<<|>>>>>>>|\|\|\|\|\|\|\|) /
const SHOWN = 20

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === '.git' ? [] : files(path)
    return entry.isFile() ? [path] : []
  })
}

function markers(root: string): string[] {
  return files(root).flatMap((path) => {
    const bytes = readFileSync(path)
    if (bytes.includes(0)) return []
    return bytes
      .toString('utf8')
      .split('\n')
      .flatMap((line, at) => (MARKER.test(line) ? [`${path}:${at + 1}:${line}`] : []))
  })
}

function main(args: string[]): number {
  const [root = '.', baseline = '-', ...count] = args
  const found = markers(root)
  if (found.length) {
    process.stderr.write(`verify_clean: ${found.length} conflict marker(s) remain under ${root}\n`)
    process.stderr.write(`${found.slice(0, SHOWN).join('\n')}\n`)
    return 1
  }
  const [command, ...rest] = count
  if (baseline === '-' || command === undefined) {
    process.stdout.write('verify_clean: 0 markers\n')
    return 0
  }
  const done = spawnSync(command, rest, { encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] })
  if (done.error) {
    process.stderr.write(`verify_clean: ${command}: ${done.error.message}\n`)
    return 127
  }
  if (done.status !== 0) return done.status ?? 1
  const current = (done.stdout ?? '').replace(/[\n\t ]/g, '')
  if (!/^[0-9]+$/.test(current)) {
    process.stderr.write(`verify_clean: count command must print a bare integer, got '${current}'\n`)
    return 1
  }
  if (Number(current) < Number(baseline)) {
    process.stderr.write(`verify_clean: pass-count regressed: ${current} < baseline ${baseline}\n`)
    return 1
  }
  process.stdout.write(`verify_clean: 0 markers, pass-count ${current} >= ${baseline}\n`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
