import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const REPO = join(import.meta.dirname, '..', '..', '..')
const FORMAT = join('plugins', 'dossier', 'FORMAT.md')
const BUILD = join('plugins', 'dossier', 'skills', 'build', 'SKILL.md')
const BRACES = /reason class ∈ `\{([^}]*)\}`/g
const ROW = /^\|\s*`([a-z-]+)`\s*\|/gm

const DIVERGENT = 1
const UNPARSEABLE = 2

type Verdict = { code: number; notes: string[] }

function rows(block: string, notes: string[]): Set<string> | number {
  const found = [...block.matchAll(ROW)].map((match) => match[1] ?? '')
  const repeated = [...new Set(found.filter((label, at) => found.indexOf(label) !== at))].sort()
  if (repeated.length) {
    notes.push(`duplicated rows: ${repeated.join(', ')}`)
    return DIVERGENT
  }
  return new Set(found)
}

function parity(root: string): Verdict {
  const notes: string[] = []
  const read = (path: string): string | undefined => {
    try {
      return statSync(join(root, path)).isFile() ? readFileSync(join(root, path), 'utf8') : undefined
    } catch {
      return undefined
    }
  }
  const format = read(FORMAT)
  const skill = read(BUILD)
  if (format === undefined || skill === undefined) return { code: UNPARSEABLE, notes: ['missing FORMAT.md or build/SKILL.md'] }
  const sets = [...format.matchAll(BRACES)]
  if (sets.length !== 1) return { code: UNPARSEABLE, notes: [`FORMAT.md must carry exactly one 'reason class' brace set, found ${sets.length}`] }
  const tokens = (sets[0]?.[1] ?? '')
    .split(',')
    .map((token) => token.trim().replace(/^`+|`+$/g, '').trim())
    .filter(Boolean)
  const repeated = [...new Set(tokens.filter((token, at) => tokens.indexOf(token) !== at))].sort()
  if (repeated.length) return { code: DIVERGENT, notes: [`duplicated brace-set tokens: ${repeated.join(', ')}`] }
  const parts = skill.split('MUST PAUSE')
  const after = parts[1]
  const excuseParts = after?.split('**Excuse table')
  if (parts.length < 2 || after === undefined || excuseParts === undefined || excuseParts.length < 2) {
    return { code: UNPARSEABLE, notes: ['build/SKILL.md is missing a PAUSE table anchor'] }
  }
  const boundary = rows(excuseParts[0] ?? '', notes)
  const excuse = rows((excuseParts[1] ?? '').split('**Rails:**')[0] ?? '', notes)
  if (typeof boundary === 'number' || typeof excuse === 'number') return { code: DIVERGENT, notes }
  const tables: [string, Set<string>][] = [
    ['FORMAT.md brace set', new Set(tokens)],
    ['decision-boundary table', boundary],
    ['excuse table', excuse],
  ]
  const empty = tables.filter(([, value]) => !value.size)
  if (empty.length) return { code: UNPARSEABLE, notes: empty.map(([name]) => `${name} parsed empty`) }
  const reference = tables[0]?.[1] ?? new Set<string>()
  for (const [name, value] of tables) {
    const missing = [...reference].filter((label) => !value.has(label)).sort()
    const extra = [...value].filter((label) => !reference.has(label)).sort()
    if (missing.length || extra.length) notes.push(`${name} diverges: missing=${missing.join(',')} extra=${extra.join(',')}`)
  }
  return { code: notes.length ? DIVERGENT : 0, notes }
}

function mutated(file: string, edit: (body: string) => string): Verdict {
  const root = mkdtempSync(join(tmpdir(), 'ds-parity-'))
  try {
    for (const path of [FORMAT, BUILD]) cpSync(join(REPO, path), join(root, path), { recursive: true })
    writeFileSync(join(root, file), edit(readFileSync(join(root, file), 'utf8')))
    return parity(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function inExcuse(edit: (tail: string) => string): (body: string) => string {
  return (body) => {
    const at = body.indexOf('**Excuse table')
    return body.slice(0, at) + edit(body.slice(at))
  }
}

const X_STALE = /^\|\s*`x-stale`\s*\|.*\n/m

test('the PAUSE classes agree across FORMAT.md and ds:build', () => {
  assert.deepEqual(parity(REPO), { code: 0, notes: [] })
})

test('an unmutated copy passes', () => {
  assert.equal(mutated(BUILD, (body) => body).code, 0)
})

test('dropping a class from the excuse table diverges', () => {
  const verdict = mutated(BUILD, inExcuse((tail) => tail.replace(X_STALE, '')))
  assert.equal(verdict.code, DIVERGENT)
  assert.match(verdict.notes.join('\n'), /excuse table diverges: missing=x-stale/)
})

test('a moved table anchor is a parse failure, not a divergence', () => {
  assert.equal(mutated(BUILD, (body) => body.replace('**Excuse table', '**Rationalization table')).code, UNPARSEABLE)
})

test('backticking each brace-set token is cosmetic', () => {
  const quoted = (body: string) =>
    body.replace(/reason class ∈ `\{([^}]*)\}`/, (_, inner: string) => {
      const tokens = inner.split(',').map((token) => `\`${token.trim()}\``)
      return `reason class ∈ \`{${tokens.join(', ')}}\``
    })
  assert.equal(mutated(FORMAT, quoted).code, 0)
})

test('a repeated brace-set token diverges', () => {
  const doubled = (body: string) =>
    body.replace(/reason class ∈ `\{([^}]*)\}`/, (_, inner: string) => `reason class ∈ \`{${inner}, ${inner.split(',')[0]?.trim()}}\``)
  assert.equal(mutated(FORMAT, doubled).code, DIVERGENT)
})

test('a repeated row inside a PAUSE table diverges', () => {
  const verdict = mutated(BUILD, inExcuse((tail) => tail.replace(X_STALE, (row) => row + row)))
  assert.equal(verdict.code, DIVERGENT)
  assert.match(verdict.notes.join('\n'), /duplicated rows: x-stale/)
})

test('zero brace sets and two brace sets are parse failures', () => {
  assert.equal(mutated(FORMAT, (body) => body.replace(/reason class ∈ `\{[^}]*\}`/, 'reason class is open')).code, UNPARSEABLE)
  assert.equal(mutated(FORMAT, (body) => body.replace(/reason class ∈ `\{[^}]*\}`/, (set) => `${set} or ${set}`)).code, UNPARSEABLE)
})
