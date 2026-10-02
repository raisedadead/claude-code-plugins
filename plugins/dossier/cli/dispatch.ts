import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { invariantVerdict, parseRegistry, skippedAdvisory } from '../engine/guards.ts'

const EXIT_USAGE = 64

function invariantCheck(args: string[]): number {
  const [root] = args
  if (root === undefined) {
    console.error('usage: ds invariant-check <project-root> < {"file_path", "chunks"}')
    return EXIT_USAGE
  }
  let registryText: string
  try {
    registryText = readFileSync(join(root, '.scratchpad/dossier/.invariant-guards.json'), 'utf8')
  } catch {
    return 0
  }
  let payload: unknown
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return 0
  }
  const { file_path: filePath, chunks } = (payload ?? {}) as { file_path?: unknown; chunks?: unknown }
  if (typeof filePath !== 'string' || !Array.isArray(chunks)) return 0
  const verdict = invariantVerdict({ filePath, chunks: chunks.map(String) }, parseRegistry(registryText))
  if (verdict.deny) {
    console.log(verdict.deny)
    return 1
  }
  if (verdict.skipped.length) console.log(skippedAdvisory(verdict.skipped))
  return 0
}

const VERBS: Record<string, (args: string[]) => number> = {
  'invariant-check': invariantCheck,
}

export async function main(args: string[]): Promise<number> {
  const [verb, ...rest] = args
  const run = verb === undefined ? undefined : VERBS[verb]
  if (!run) {
    console.error(`usage: ds <${Object.keys(VERBS).join('|')}> [args]`)
    return EXIT_USAGE
  }
  return run(rest)
}
