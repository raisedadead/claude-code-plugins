import { CELL, splitLines, strip, unicodeRegex } from './text.ts'

const ROW = unicodeRegex('^\\|(.+)\\|\\s*$')
const EXIT = unicodeRegex('^exit\\s+(?:(\\d+)|(0)\\s+guard)$')
export const STDOUT_HINT =
  'stdout: is not an expect; check the output inside the command and expect exit 0, as `test "$(cmd)" -eq N` for a count or `test -z "$(cmd)"` for no output'
const DETAIL_MAX = 120
const RUNTIME_SUFFIXES = new Set(['.py', '.sh', '.js', '.ts', '.go', '.rs', '.rb'])
const DOC_SUFFIXES = new Set(['.md', '.json', '.txt', '.yml', '.yaml'])
const TEST_DIRS = new Set(['test', 'tests', '__tests__', 'spec'])

export const DATE_PREFIX = unicodeRegex('^\\d{4}-\\d{2}-\\d{2}-')

export function contractPaths(repos: readonly string[], waveDir: string): string[] {
  const name = waveDir.split('/').filter(Boolean).pop() ?? ''
  const stems = [...new Set([name, name.replace(DATE_PREFIX, '')])]
  return [...repos.flatMap((repo) => stems.map((stem) => `${repo}/.dossier/${stem}.md`)), `${waveDir}/CONTRACT.md`]
}

function rstrip(text: string): string {
  return text.replace(unicodeRegex('\\s+$'), '')
}

export function cells(line: string): string[] {
  const match = ROW.exec(rstrip(line))
  if (!match) return []
  return (match[1] ?? '').split(CELL).map((cell) => strip(cell.replaceAll('\\|', '|')))
}

export function shlexWords(text: string): string[] | undefined {
  const words: string[] = []
  let word = ''
  let started = false
  let quote = ''
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    if (quote === "'") {
      if (char === "'") quote = ''
      else word += char
      continue
    }
    if (quote === '"') {
      if (char === '"') quote = ''
      else if (char === '\\' && (text[i + 1] === '"' || text[i + 1] === '\\')) word += text[++i]
      else word += char
      continue
    }
    if (char === '\\') {
      if (i + 1 >= text.length) return undefined
      word += text[++i]
      started = true
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (/[ \t\r\n]/.test(char)) {
      if (started) words.push(word)
      word = ''
      started = false
    } else {
      word += char
      started = true
    }
  }
  if (quote) return undefined
  if (started) words.push(word)
  return words
}

export const PIPE_HINT =
  'a | in a grep -E, egrep, grep -P or rg pattern means "or"; match a literal pipe with [|], written [\\|] in the table; for or, use grep -e A -e B'

function shellSegments(text: string): string[][] {
  const segments: string[][] = [[]]
  let word = ''
  let started = false
  let quote = ''
  const end = (): void => {
    if (started) segments[segments.length - 1]?.push(word)
    word = ''
    started = false
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i] ?? ''
    if (quote) {
      if (char === quote) quote = ''
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (char === '\\') {
      word += text[++i] ?? ''
      started = true
    } else if ('|;&\n()`'.includes(char)) {
      end()
      segments.push([])
    } else if (/[ \t\r]/.test(char)) end()
    else {
      word += char
      started = true
    }
  }
  end()
  return segments
}

const SEARCH_TOOLS = new Set(['grep', 'egrep', 'rg'])
const NESTED_SCRIPTS = 4

function regexSearch(words: string[]): boolean {
  const at = words.findIndex((word) => SEARCH_TOOLS.has(word.split('/').pop() ?? ''))
  if (at < 0) return false
  const tool = words[at]?.split('/').pop()
  const args = words.slice(at + 1)
  if (tool === 'egrep') return true
  if (tool === 'rg') return !args.some((arg) => arg === '--fixed-strings' || /^-[a-zA-Z]*F/.test(arg))
  return args.some((arg) => arg === '--extended-regexp' || arg === '--perl-regexp' || /^-[a-zA-Z]*[EP]/.test(arg))
}

function namesRegexSearch(command: string, depth = 0): boolean {
  if (depth > NESTED_SCRIPTS) return false
  return shellSegments(command).some((words) => regexSearch(words) || words.some((word) => /\s/.test(word) && namesRegexSearch(word, depth + 1)))
}

export function pipeInPattern(command: string): boolean {
  const quotedPipe = shellSegments(command)
    .flat()
    .some((word) => word.replace(/\[[^\]]*\]/g, '').includes('|'))
  return quotedPipe && namesRegexSearch(command)
}

export function isCommand(text: string): boolean {
  if (!(text.startsWith('`') && text.endsWith('`') && text.length > 2)) return false
  return (shlexWords(text.slice(1, -1))?.length ?? 0) > 0
}

export function numberedRows(text: string): string[][] {
  const at = text.indexOf('## done-when')
  if (at < 0) return []
  const body = text.slice(at + '## done-when'.length).split('\n## ')[0] ?? ''
  return splitLines(body)
    .map(cells)
    .filter((row) => row.length > 0 && /^\p{Nd}+$/u.test(row[0] ?? ''))
}

export function field(text: string, name: string): string {
  for (const line of splitLines(text)) {
    const row = cells(line)
    if (row.length >= 2 && (row[0] ?? '').toLowerCase() === name) return row[1] ?? ''
  }
  return ''
}

export function hasConsumer(text: string): boolean {
  return splitLines(text).some((line) => {
    const row = cells(line)
    return row.length >= 2 && (row[0] ?? '').toLowerCase() === 'consumer' && Boolean(row[1])
  })
}

export function expectedExit(expect: string): number | undefined {
  const exit = EXIT.exec(strip(expect))
  return exit ? Number(exit[1] ?? exit[2]) : undefined
}

export function isGuard(expect: string): boolean {
  return EXIT.exec(strip(expect))?.[2] !== undefined
}

export function detail(stream: string): string {
  for (const raw of splitLines(stream)) {
    const line = strip(raw)
    if (line) return [...line].slice(0, DETAIL_MAX).join('')
  }
  return ''
}

function escaped(point: number): string {
  if (point < 0x100) return `\\x${point.toString(16).padStart(2, '0')}`
  if (point < 0x10000) return `\\u${point.toString(16).padStart(4, '0')}`
  return `\\U${point.toString(16).padStart(8, '0')}`
}

export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'"
  let out = ''
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0
    if (char === '\\') out += '\\\\'
    else if (char === quote) out += `\\${quote}`
    else if (char === '\n') out += '\\n'
    else if (char === '\r') out += '\\r'
    else if (char === '\t') out += '\\t'
    else if (char !== ' ' && /[\p{C}\p{Z}]/u.test(char)) out += escaped(point)
    else out += char
  }
  return `${quote}${out}${quote}`
}

function suffixOf(name: string): string {
  const at = name.lastIndexOf('.')
  return at <= 0 || at === name.length - 1 ? '' : name.slice(at)
}

function isTest(path: string): boolean {
  const parts = path.split('/').filter((part) => part !== '' && part !== '.')
  const name = parts[parts.length - 1] ?? ''
  const stem = name.slice(0, name.length - suffixOf(name).length)
  return parts.some((part) => TEST_DIRS.has(part)) || name.startsWith('test_') || ['_test', '.test', '_spec', '.spec'].some((end) => stem.endsWith(end))
}

export function layerMix(numstat: string): string {
  if (!strip(numstat)) return ''
  let runtime = 0
  let docs = 0
  let tests = 0
  for (const line of splitLines(numstat)) {
    const parts = line.split('\t')
    if (parts.length !== 3 || !/^\p{Nd}+$/u.test(parts[0] ?? '') || !/^\p{Nd}+$/u.test(parts[1] ?? '')) continue
    const changed = Number(parts[0]) + Number(parts[1])
    const path = parts[2] ?? ''
    const suffix = suffixOf(path.split('/').pop() ?? '').toLowerCase()
    if (isTest(path)) tests += changed
    else if (RUNTIME_SUFFIXES.has(suffix)) runtime += changed
    else if (DOC_SUFFIXES.has(suffix)) docs += changed
  }
  return `  lines since contract: runtime ${runtime} · tests ${tests} · docs ${docs}`
}
