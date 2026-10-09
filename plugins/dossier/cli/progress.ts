import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DATE_PREFIX, field } from '../engine/converge.ts'
import { laterLine, progress, progressLine, progressTable } from '../engine/progress.ts'
import { liveSlugs, waveContract } from './converge.ts'

const USAGE = 'usage: ds progress [<dossier-dir>] [--line | --json]'

function report(dir: string, root: string, mode: string): string {
  const file = join(dir, 'DOSSIER.md')
  if (!existsSync(file)) throw new Error(`ds progress: not found: ${file}`)
  const contract = waveContract(dir, root)
  const milestone = contract ? field(readFileSync(contract, 'utf8'), 'milestone') || undefined : undefined
  const view = progress(readFileSync(file, 'utf8'), milestone)
  const slug = (dir.split('/').filter(Boolean).pop() ?? '').replace(DATE_PREFIX, '')
  if (mode === '--json') return JSON.stringify({ slug, ...view })
  return mode === '--line' ? progressLine(slug, view) : progressTable(slug, view)
}

function later(root: string): string[] {
  const archive = join(root, '.scratchpad', 'dossier', '_archive')
  let names: string[] = []
  try {
    names = readdirSync(archive).sort()
  } catch {
    return []
  }
  return names.flatMap((name) => {
    const file = join(archive, name, 'DOSSIER.md')
    if (!existsSync(file)) return []
    return laterLine(name.replace(DATE_PREFIX, ''), readFileSync(file, 'utf8'), new Date()) ?? []
  })
}

export function progressVerb(args: string[]): number {
  const mode = args.find((arg) => arg.startsWith('--')) ?? ''
  const given = args.find((arg) => !arg.startsWith('--'))
  if (mode && !['--line', '--json'].includes(mode)) {
    console.error(`ds progress: ${USAGE}`)
    return 2
  }
  const root = process.env.DOSSIER_LEDGER_ROOT || process.cwd()
  const dirs =
    given === undefined
      ? liveSlugs(root).map((slug) => join(root, '.scratchpad', 'dossier', slug))
      : [existsSync(given) ? resolve(given) : join(root, given)]
  try {
    const out = dirs.map((dir) => report(dir, root, mode))
    if (given === undefined && mode !== '--json') out.push(...later(root))
    if (out.length) console.log(out.join(mode === '--line' || mode === '--json' ? '\n' : '\n\n'))
    return 0
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}
