import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { expectedExit, isCommand, isGuard, numberedRows, PIPE_HINT, pipeInPattern, pyRepr } from '../engine/converge.ts'
import { splitLines } from '../engine/text.ts'
import { NOT_RUN, run } from './converge.ts'

const OK = 0
const FAIL = 1
const PARSE = 2
const MAX_BUFFER = 256 * 1024 * 1024
const CITE = /(?<![\w/.~:@-])((?:~\/|\/)?[\w.@-]+(?:\/[\w.@-]+)*\.[A-Za-z][\w]*):(\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*)(?![\w.])/g
const REMOVES = /^REMOVES:(.*)$/
const FOLDER = /(?<![\w/.~@-])((?:[\w.@-]+\/)+)(?![\w.@-])/g

class Parse extends Error {}

type Span = { from: number; to: number }
type Cite = { text: string; path: string; spans: Span[] }

function say(line: string): void {
  writeSync(1, `${line}\n`)
}

function git(repo: string, ...args: string[]): { status: number; out: string } {
  const done = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: MAX_BUFFER })
  return { status: done.status ?? 1, out: done.stdout ?? '' }
}

function prose(text: string): string {
  let fenced = false
  return splitLines(text)
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced
        return ''
      }
      return fenced ? '' : line
    })
    .join('\n')
}

function cites(text: string): Cite[] {
  const seen = new Set<string>()
  const out: Cite[] = []
  for (const match of prose(text).matchAll(CITE)) {
    const [whole, path = '', lines = ''] = match
    if (seen.has(whole)) continue
    seen.add(whole)
    const spans = lines.split(',').map((part) => {
      const [from = '0', to = from] = part.split('-')
      return { from: Number(from), to: Number(to) }
    })
    out.push({ text: whole, path, spans })
  }
  return out
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function locate(repo: string, path: string, tracked: () => string[]): string {
  if (path.startsWith('~/')) return join(homedir(), path.slice(2))
  if (isAbsolute(path)) return path
  if (path.includes('/') || isFile(join(repo, path))) return join(repo, path)
  const found = tracked().filter((name) => name === path || name.endsWith(`/${path}`))
  if (found.length > 1) throw new Error(`${found.length} tracked files are named ${path}`)
  if (!found.length) throw new Error('no file')
  return join(repo, found[0] ?? path)
}

function fileLines(path: string): string[] {
  const lines = readFileSync(path, 'utf8').split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

function checkCite(repo: string, cite: Cite, tracked: () => string[]): { error?: string; evidence?: string } {
  let file: string
  try {
    file = locate(repo, cite.path, tracked)
  } catch (error) {
    return { error: (error as Error).message }
  }
  if (!isFile(file)) return { error: 'no file' }
  const lines = fileLines(file)
  const shown: string[] = []
  for (const { from, to } of cite.spans) {
    if (from < 1 || to < from) return { error: `bad range ${from}-${to}` }
    if (to > lines.length) return { error: `line ${to} is past the end (${lines.length} lines)` }
    for (let at = from; at <= to; at += 1) shown.push(`${at}: ${lines[at - 1] ?? ''}`)
  }
  return { evidence: [`### ${cite.text}`, '', '````', ...shown, '````', ''].join('\n') }
}

function removedNames(text: string): string[] {
  return splitLines(text).flatMap((line) => {
    const found = REMOVES.exec(line.trim())
    if (!found) return []
    const name = (found[1] ?? '')
      .trim()
      .replace(/^`+|`+$/g, '')
      .trim()
    if (!name) throw new Parse('a REMOVES: line names nothing')
    return [name]
  })
}

function listed(repo: string, text: string, hit: string): boolean {
  if (text.includes(hit)) return true
  for (const match of text.matchAll(FOLDER)) {
    const folder = match[1] ?? ''
    if (folder.split('/').some((part) => part === '.' || part === '..')) continue
    if (hit.startsWith(folder) && existsSync(join(repo, folder))) return true
  }
  return false
}

function hits(repo: string, name: string, skip: Set<string>): string[] {
  const found = git(repo, 'grep', '-l', '-F', '--', name)
  if (found.status > 1) throw new Error(`git grep failed in ${repo}`)
  return splitLines(found.out).filter((path) => path && !skip.has(path) && !path.split('/').includes('CHANGELOG.md') && !/(^|\/)evals\/results\//.test(path))
}

function checkRows(text: string, repo: string): string[] {
  const rows = numberedRows(text)
  if (!rows.length) return ['FAIL checks: the notes have no ## done-when rows']
  for (const row of rows) {
    const [ident = '', command = '', expect = ''] = row
    if (row.length !== 3) throw new Parse(`check ${ident} is not exactly id | command | expect`)
    if (!isCommand(command)) throw new Parse(`check ${ident} is not a backticked command: ${pyRepr(command)}`)
    if (pipeInPattern(command.slice(1, -1))) throw new Parse(`check ${ident} — ${PIPE_HINT}`)
    if (expectedExit(expect) === undefined) throw new Parse(`check ${ident} has an unreadable expect: ${pyRepr(expect)}`)
  }
  const failures: string[] = []
  for (const [ident = '', command = '', expect = ''] of rows) {
    const result = run(command.slice(1, -1), repo, 0)
    const ok = result.code === expectedExit(expect)
    if (isGuard(expect)) {
      if (!ok) failures.push(`FAIL check ${ident}: guard got exit ${result.code}, expected ${expect}`)
    } else if (NOT_RUN.has(result.code)) {
      failures.push(`FAIL check ${ident}: did not run (exit ${result.code})`)
    } else if (ok) {
      failures.push(`FAIL check ${ident}: passes today, so it cannot show the change`)
    }
  }
  return failures
}

export function designCheckVerb(args: string[]): number {
  const [notesArg, repoArg] = args
  try {
    if (!notesArg || !repoArg) throw new Parse('usage: ds design-check <notes-file> <repo>')
    const notes = resolve(notesArg)
    const repo = resolve(repoArg)
    if (!notes.endsWith('.md') || notes.endsWith('-evidence.md')) throw new Parse('the notes file must end in .md and not in -evidence.md')
    if (!isFile(notes)) throw new Parse(`no notes file at ${notes}`)
    const text = readFileSync(notes, 'utf8').replace(/\r\n?/g, '\n')
    const names = removedNames(text)
    const evidencePath = notes.replace(/\.md$/, '-evidence.md')
    let tracked: string[] | undefined
    const trackedFiles = (): string[] => (tracked ??= splitLines(git(repo, 'ls-files').out).filter(Boolean))
    const failures: string[] = []
    const sections: string[] = [`# Evidence for ${notes}`, '']
    const found = cites(text)
    for (const cite of found) {
      const { error, evidence } = checkCite(repo, cite, trackedFiles)
      if (error) failures.push(`FAIL cite ${cite.text}: ${error}`)
      else if (evidence) sections.push(evidence)
    }
    const skip = new Set([relative(repo, notes), relative(repo, evidencePath)])
    for (const name of names) {
      for (const hit of hits(repo, name, skip)) {
        if (!listed(repo, text, hit)) failures.push(`FAIL removes ${name}: ${hit} is not in the notes`)
      }
    }
    failures.push(...checkRows(text, repo))
    writeFileSync(evidencePath, sections.join('\n'))
    for (const line of failures) say(line)
    const checks = numberedRows(text).length
    if (failures.length) {
      say(`DESIGN: FAIL ${failures.length} evidence=${evidencePath}`)
      return FAIL
    }
    say(`DESIGN: OK cites=${found.length} checks=${checks} removes=${names.length} evidence=${evidencePath}`)
    return OK
  } catch (error) {
    if (!(error instanceof Parse)) throw error
    say(`DESIGN: PARSE — ${error.message}`)
    return PARSE
  }
}
