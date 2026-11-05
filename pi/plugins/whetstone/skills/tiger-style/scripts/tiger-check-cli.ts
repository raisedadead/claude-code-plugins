import { spawnSync } from 'node:child_process'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { pythonInt, splitLines, strip } from '../../../hooks/text.ts'
import { COMBINING, WIDE } from './unicode-width.ts'

const FALLBACK_COLS = 100
const TAB_STOP = 8
const BRACE_LIMIT = 256
const MAX_CONFIG_DEPTH = 64
const OFF = -1
const CLEAN = 0
const BLOCK = 1
const NAG = 2
const USAGE = 64

const SKIP_SUFFIXES = new Set(['.md', '.markdown', '.rst', '.txt', '.json', '.jsonl', '.csv', '.tsv', '.svg', '.lock', '.snap'])
const SKIP_NAMES = new Set(['go.sum', 'pnpm-lock.yaml'])
const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/

type Git = { status: number; stdout: string }
type Entry = { rel: string; paths: string[] }
type Token = { kind: 'globstar/' | 'globstar' | 'star' | 'any' | 'class' | 'lit'; body: string }

function runGit(root: string, ...args: string[]): Git {
  const done = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 1 << 30 })
  if (done.error || done.status === null) return { status: 127, stdout: '' }
  return { status: done.status, stdout: done.stdout }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function resolvePath(path: string): string {
  const absolute = resolve(path)
  try {
    return realpathSync(absolute)
  } catch {
    const parent = dirname(absolute)
    return parent === absolute ? absolute : join(resolvePath(parent), basename(absolute))
  }
}

function workTreeTop(root: string): string | undefined {
  if (!isDir(root)) return undefined
  const probe = runGit(root, 'rev-parse', '--show-toplevel')
  if (probe.status !== 0) return undefined
  return strip(probe.stdout) || undefined
}

function stagedEntries(root: string): Entry[] {
  const listing = runGit(root, 'diff', '--cached', '--name-status', '-z', '-M', '--diff-filter=ACMRT')
  if (listing.status !== 0) return []
  const tokens = listing.stdout.split('\0').filter(Boolean)
  const entries: Entry[] = []
  let index = 0
  while (index < tokens.length - 1) {
    const status = tokens[index] ?? ''
    if ('RC'.includes(status.slice(0, 1)) && status && index + 2 < tokens.length) {
      const old = tokens[index + 1] ?? ''
      const fresh = tokens[index + 2] ?? ''
      entries.push({ rel: fresh, paths: [old, fresh] })
      index += 3
    } else {
      const path = tokens[index + 1] ?? ''
      entries.push({ rel: path, paths: [path] })
      index += 2
    }
  }
  return entries
}

function addedLines(root: string, paths: string[]): Array<[number, string]> {
  const diff = runGit(root, 'diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff', '-M', '--', ...paths)
  if (diff.status !== 0) return []
  const added: Array<[number, string]> = []
  let lineno = 0
  let inBody = false
  for (const raw of splitLines(diff.stdout)) {
    const hunk = HUNK.exec(raw)
    if (hunk) {
      lineno = Number(hunk[1])
      inBody = true
      continue
    }
    if (inBody && raw.startsWith('+')) {
      added.push([lineno, raw.slice(1)])
      lineno += 1
    }
  }
  return added
}

function expandBraces(pattern: string): string[] {
  let current = [pattern]
  for (;;) {
    const expanded: string[] = []
    let changed = false
    for (const item of current) {
      const match = /\{([^{}]*)\}/.exec(item)
      if (!match) {
        expanded.push(item)
        continue
      }
      changed = true
      const head = item.slice(0, match.index)
      const tail = item.slice(match.index + match[0].length)
      for (const choice of (match[1] ?? '').split(',')) expanded.push(head + choice + tail)
    }
    if (!changed) return current
    if (expanded.length > BRACE_LIMIT) return [pattern]
    current = expanded
  }
}

function tokens(pattern: string[]): Token[] {
  const out: Token[] = []
  let i = 0
  const at = (j: number) => pattern[j] ?? ''
  while (i < pattern.length) {
    const char = at(i)
    if (char === '*' && at(i + 1) === '*' && at(i + 2) === '/') {
      out.push({ kind: 'globstar/', body: '' })
      i += 3
    } else if (char === '*' && at(i + 1) === '*') {
      out.push({ kind: 'globstar', body: '' })
      i += 2
    } else if (char === '*') {
      out.push({ kind: 'star', body: '' })
      i += 1
    } else if (char === '?') {
      out.push({ kind: 'any', body: '' })
      i += 1
    } else if (char === '[') {
      const close = pattern.indexOf(']', i + 1)
      if (close === -1) {
        out.push({ kind: 'lit', body: char })
        i += 1
      } else {
        out.push({ kind: 'class', body: pattern.slice(i + 1, close).join('') })
        i = close + 1
      }
    } else {
      out.push({ kind: 'lit', body: char })
      i += 1
    }
  }
  if (!pattern.includes('/')) out.unshift({ kind: 'globstar/', body: '' })
  return out
}

function inClass(classBody: string, char: string): boolean {
  let body = [...classBody]
  const negated = body[0] === '!'
  if (negated) body = body.slice(1)
  const point = char.codePointAt(0) ?? 0
  let hit = false
  let i = 0
  while (i < body.length) {
    if (i + 2 < body.length && body[i + 1] === '-') {
      const low = body[i]?.codePointAt(0) ?? 0
      const high = body[i + 2]?.codePointAt(0) ?? 0
      hit = hit || (low <= point && point <= high)
      i += 3
    } else {
      hit = hit || body[i] === char
      i += 1
    }
  }
  return hit !== negated
}

function globMatches(pattern: string, rel: string): boolean {
  const path = [...rel]
  const length = path.length
  let reachable = Array<boolean>(length + 1).fill(false)
  reachable[0] = true
  for (const { kind, body } of tokens([...pattern])) {
    const next = Array<boolean>(length + 1).fill(false)
    if (kind === 'star' || kind === 'globstar') {
      let run = false
      for (let j = 0; j <= length; j++) {
        run = run || Boolean(reachable[j])
        next[j] = run
        if (kind === 'star' && j < length && path[j] === '/') run = false
      }
    } else if (kind === 'globstar/') {
      let run = false
      for (let j = 0; j <= length; j++) {
        run = run || Boolean(reachable[j])
        next[j] = Boolean(reachable[j]) || (run && j > 0 && path[j - 1] === '/')
      }
    } else {
      for (let j = 0; j < length; j++) {
        if (!reachable[j]) continue
        const char = path[j] ?? ''
        if (kind === 'lit') next[j + 1] = char === body
        else if (kind === 'any') next[j + 1] = char !== '/'
        else next[j + 1] = inClass(body, char)
      }
    }
    if (!next.some(Boolean)) return false
    reachable = next
  }
  return Boolean(reachable[length])
}

function sections(text: string): Array<[string, Map<string, string>]> {
  const preamble = new Map<string, string>()
  const found: Array<[string, Map<string, string>]> = [['', preamble]]
  let current = preamble
  for (const raw of splitLines(text)) {
    const line = strip(raw)
    if (!line || '#;'.includes(line[0] ?? '')) continue
    if (line.startsWith('[') && line.endsWith(']')) {
      current = new Map()
      found.push([line.slice(1, -1), current])
    } else if (line.includes('=')) {
      const equals = line.indexOf('=')
      current.set(strip(line.slice(0, equals)).toLowerCase(), strip(line.slice(equals + 1)))
    }
  }
  return found
}

function readText(path: string): string {
  return readFileSync(path, 'utf8')
}

function configChain(root: string, rel: string): string[] {
  const chain: string[] = []
  let current = resolvePath(dirname(join(root, rel)))
  const stop = resolvePath(root)
  for (let depth = 0; depth < MAX_CONFIG_DEPTH; depth++) {
    const candidate = join(current, '.editorconfig')
    if (isFile(candidate)) {
      chain.push(candidate)
      const preamble = sections(readText(candidate))[0]?.[1]
      if ((preamble?.get('root') ?? '').toLowerCase() === 'true') break
    }
    if (current === stop || dirname(current) === current) break
    current = dirname(current)
  }
  return chain
}

function positiveInt(raw: string): number | undefined {
  const value = pythonInt(raw)
  return value !== undefined && value > 0 ? value : undefined
}

function editorconfigLimit(root: string, rel: string): number | undefined {
  let limit: number | undefined
  const target = resolvePath(join(root, rel))
  for (const config of configChain(root, rel).reverse()) {
    const base = resolvePath(dirname(config))
    const scoped = relative(base, target)
    if (scoped === '..' || scoped.startsWith('..' + sep) || scoped === '' || resolve(base, scoped) !== target) continue
    for (const [glob, values] of sections(readText(config))) {
      const declared = values.get('max_line_length')
      if (!glob || declared === undefined) continue
      const posix = scoped.split(sep).join('/')
      if (!expandBraces(glob).some((alt) => globMatches(alt, posix))) continue
      const raw = declared.toLowerCase()
      if (raw === 'off') {
        limit = OFF
        continue
      }
      const parsed = positiveInt(raw)
      if (parsed === undefined) {
        console.error(`tiger-check: ignoring max_line_length='${raw}' in ${config} — expected a positive integer or 'off'`)
        continue
      }
      limit = parsed
    }
  }
  return limit
}

function envLimit(): number | undefined {
  const raw = strip(process.env.WHETSTONE_TIGER_COLS ?? '')
  if (!raw) return undefined
  const parsed = positiveInt(raw)
  if (parsed === undefined) {
    console.error(`tiger-check: ignoring WHETSTONE_TIGER_COLS='${raw}' — expected a positive integer`)
  }
  return parsed
}

function inRanges(point: number, ranges: ReadonlyArray<readonly [number, number]>): boolean {
  let low = 0
  let high = ranges.length - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    const [start, end] = ranges[middle] ?? [0, -1]
    if (point < start) high = middle - 1
    else if (point > end) low = middle + 1
    else return true
  }
  return false
}

function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0
    if (char === '\t') width += TAB_STOP - (width % TAB_STOP)
    else if (inRanges(point, COMBINING)) continue
    else if (inRanges(point, WIDE)) width += 2
    else width += 1
  }
  return width
}

function suffix(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot <= 0 || dot === name.length - 1 ? '' : name.slice(dot)
}

function skipped(rel: string): boolean {
  const name = rel.split('/').pop() ?? rel
  return SKIP_SUFFIXES.has(suffix(name).toLowerCase()) || SKIP_NAMES.has(name)
}

function main(args: string[]): number {
  const given = args[0] || '.'
  const root = workTreeTop(given)
  if (root === undefined) {
    console.error(`tiger-check: not a git work tree: ${given}`)
    return USAGE
  }
  const env = envLimit()
  const reported: string[] = []
  let declaredCount = 0
  let examined = 0
  let skippedCount = 0
  for (const { rel, paths } of stagedEntries(root)) {
    if (skipped(rel)) {
      skippedCount += 1
      continue
    }
    const limit = env ?? editorconfigLimit(root, rel)
    if (limit === OFF) {
      skippedCount += 1
      continue
    }
    examined += 1
    const effective = limit ?? FALLBACK_COLS
    for (const [lineno, text] of addedLines(root, paths)) {
      const width = displayWidth(text.replace(/[\r\n]+$/, ''))
      if (width <= effective) continue
      if (limit !== undefined) declaredCount += 1
      reported.push(`${rel}:${lineno}: ${width} cols (limit ${effective})`)
    }
  }
  for (const entry of reported) console.log(entry)
  if (!reported.length) {
    const tail = skippedCount ? `, ${skippedCount} skipped` : ''
    console.log(`TIGER: CLEAN ${examined} file${examined === 1 ? '' : 's'}${tail}`)
    return CLEAN
  }
  if (declaredCount) {
    console.log(`TIGER: BLOCK ${declaredCount}`)
    return BLOCK
  }
  console.log(`TIGER: NAG ${reported.length}`)
  return NAG
}

process.exitCode = main(process.argv.slice(2))
