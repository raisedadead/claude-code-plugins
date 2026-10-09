import { CELL, strip, unicodeRegex } from './text.ts'

const SPACE = '[ \\t\\n\\r\\f\\v]'

function section(tag: string, word: string): RegExp {
  return new RegExp(`^## (§${tag}([^A-Za-z]|$)|${word}(${SPACE}|$))`)
}

export const SEC = {
  any: /^## /,
  goal: section('G', 'Goal'),
  constraints: section('C', 'Constraints'),
  interfaces: section('I', 'Interfaces'),
  invariants: section('V', 'Invariants'),
  tasks: section('T', 'Tasks'),
  bugs: section('B', 'Bugs'),
  repos: section('X', 'Repos'),
  status: section('S', 'Status'),
  closeout: section('Z', 'Closeout'),
}

export const Z = {
  complete: new RegExp(`^${SPACE}*complete:${SPACE}+true`),
  abandoned: new RegExp(`^${SPACE}*abandoned:${SPACE}+true`),
  successor: new RegExp(`^${SPACE}*successor:${SPACE}+[a-z0-9][a-z0-9-]*(${SPACE}|$)`),
  slug: /^[a-z0-9][a-z0-9-]*$/,
}

export const HEADER = unicodeRegex('^`\\d[^`]*`\\s+·\\s+`([^`]*)`(?:\\s+·\\s|\\s*$)')
const TASK_ROW = /^\|[ \t\n\r\f\v]*T[0-9]+[ \t\n\r\f\v]*\|/
const BUG_ROW = /^\|[ \t\n\r\f\v]*B[0-9]+[ \t\n\r\f\v]*\|/
const RULE_ROW = /^[-| :+]*$/

export type Result = { text: string } | { error: string }

export function lines(text: string): string[] {
  if (text === '') return []
  const out = text.split('\n')
  if (out[out.length - 1] === '') out.pop()
  return out
}

export function unlines(rows: string[]): string {
  return rows.map((row) => `${row}\n`).join('')
}

export function trim(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '')
}

function closureLine(line: string): boolean {
  return Z.complete.test(line) || Z.abandoned.test(line) || Z.successor.test(line)
}

function* inSection(rows: string[], pattern: RegExp): Generator<[number, string, boolean]> {
  let inside = false
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] ?? ''
    if (pattern.test(row)) {
      inside = true
      yield [i, row, false]
      continue
    }
    if (SEC.any.test(row)) inside = false
    yield [i, row, inside]
  }
}

function columns(header: string, names: string[]): Record<string, number> {
  const cells = header.split(CELL)
  const found: Record<string, number> = {}
  for (let i = 1; i < cells.length - 1; i++) {
    const name = trim(cells[i] ?? '')
    if (names.includes(name)) found[name] = i
  }
  return found
}

export function rowFlip(text: string, file: string, id: string, state: string, cite: string): Result {
  const rows = lines(text)
  let found = 0
  let header = false
  let colState = 0
  let colCite = 0
  let rowCells = 0
  let current = ''
  for (const [, row, inside] of inSection(rows, SEC.tasks)) {
    if (SEC.tasks.test(row)) {
      header = false
      colState = 0
      colCite = 0
      continue
    }
    if (!inside || !row.startsWith('|')) continue
    const cells = row.split(CELL)
    if (!header) {
      header = true
      const named = columns(row, ['state', 'cite'])
      colState = named.state ?? 0
      colCite = named.cite ?? 0
      continue
    }
    if (trim(cells[1] ?? '') === id) {
      found++
      rowCells = cells.length
      current = colCite ? trim(cells[colCite] ?? '') : ''
    }
  }
  if (!colState || !colCite) {
    return { error: `Tasks header in ${file} names no state/cite column; refusing to edit by position` }
  }
  if (found === 1 && (colState >= rowCells - 1 || colCite >= rowCells - 1)) {
    return { error: `row ${id} has ${rowCells - 2} cells, fewer than the header names; refusing to write past its end` }
  }
  if (found === 0) return { error: `row id ${id} not found in the Tasks section of ${file}` }
  if (found > 1) return { error: `row id ${id} matches ${found} Tasks rows (ambiguous)` }
  if (state === 'x') {
    const effective = (cite || current).replace(/[ \t\n\r\f\v]/g, '')
    if (effective === '' || effective === '—' || effective === '-') {
      return {
        error: `${id} -> x requires a cite (Vm.3); ds vm-checks reads "", "—" and "-" alike as empty, so pass a real cite or set the row cite first`,
      }
    }
  }
  const out: string[] = []
  header = false
  for (const [, row, inside] of inSection(rows, SEC.tasks)) {
    if (SEC.tasks.test(row)) header = false
    if (!inside || !row.startsWith('|')) {
      out.push(row)
      continue
    }
    if (!header) {
      header = true
      out.push(row)
      continue
    }
    const cells = row.split(CELL)
    if (trim(cells[1] ?? '') !== id) {
      out.push(row)
      continue
    }
    cells[colState] = ` ${state} `
    if (cite !== '') cells[colCite] = ` ${cite.replaceAll('|', '\\|')} `
    out.push(`|${cells.slice(1, -1).join('|')}|`)
  }
  return { text: unlines(out) }
}

export function sAppend(text: string, entry: string): string {
  const out: string[] = []
  let done = false
  for (const row of lines(text)) {
    if (!done && SEC.closeout.test(row)) {
      out.push(entry, '')
      done = true
    }
    out.push(row)
  }
  return done ? unlines(out) : `${unlines(out)}\n${entry}\n`
}

export function headerIndex(rows: readonly string[]): number {
  const end = rows.findIndex((row) => row.startsWith('## '))
  return rows.slice(0, end < 0 ? rows.length : end).findIndex((row) => HEADER.test(row))
}

export function headerState(text: string, state: string): string | undefined {
  const rows = lines(text)
  const at = headerIndex(rows)
  if (at < 0) return undefined
  const parts = (rows[at] ?? '').split('`')
  parts[3] = state
  rows[at] = parts.join('`')
  return unlines(rows)
}

export function headerToken(text: string): string {
  const rows = lines(text)
  return strip(HEADER.exec(rows[headerIndex(rows)] ?? '')?.[1] ?? '')
}

function repoRows(text: string): Generator<[number, string, boolean]> {
  return inSection(lines(text), SEC.repos)
}

export function hasRepo(text: string, label: string): boolean {
  for (const [, row, inside] of repoRows(text)) {
    if (inside && row.startsWith('|') && trim(row.split(CELL)[1] ?? '') === label) return true
  }
  return false
}

export function xRefresh(text: string, label: string, values: [string, string, string, string]): string {
  const out: string[] = []
  for (const [, row, inside] of repoRows(text)) {
    if (!inside || !row.startsWith('|')) {
      out.push(row)
      continue
    }
    const cells = row.split(CELL)
    if (trim(cells[1] ?? '') !== label) {
      out.push(row)
      continue
    }
    const width = cells.length
    values.forEach((value, i) => {
      cells[i + 2] = ` ${value} `
    })
    out.push(`|${cells.slice(1, width - 1).join('|')}|`)
  }
  return unlines(out)
}

export function zWrite(
  text: string,
  file: string,
  kind: string,
  value: string,
  summary: string,
  cites: string,
  stamp: string,
  after = '',
): Result {
  let body: string
  if (kind === 'complete') body = 'complete: true'
  else if (kind === 'successor') {
    if (!Z.slug.test(value)) return { error: `successor takes a slug (${Z.slug.source}), got "${value}"` }
    body = `successor: ${value}`
  } else if (kind === 'abandoned') {
    if (value === '') return { error: 'abandoned requires a reason' }
    body = `abandoned: true\n\nreason: ${value}`
  } else return { error: `invalid kind "${kind}" (complete|successor|abandoned)` }
  const checks: [string, string][] = [
    ['summary', `summary: ${summary}`],
    ['key cites', `key cites: ${cites}`],
  ]
  if (kind === 'abandoned') checks.push(['reason', `reason: ${value}`])
  if (after) checks.push(['after', `after: ${after}`])
  for (const [label, rendered] of checks) {
    if (lines(rendered).some(closureLine)) {
      return { error: `${label} reads as a §Z closure key and would flip the INDEX §Z column; reword it` }
    }
  }
  const rows = lines(text)
  const at = rows.findIndex((row) => SEC.closeout.test(row))
  if (at < 0) return { error: `no Closeout heading in ${file}` }
  const head = unlines(rows.slice(0, at))
  const carried = after ? `\n\nafter: ${after}` : ''
  return { text: `${head}${rows[at]}\n\n${stamp} — closed\n\n${body}${carried}\n\nsummary: ${summary}\n\nkey cites: ${cites}\n` }
}

export function missingSections(text: string): string[] {
  const rows = lines(text)
  const missing: string[] = []
  if (!rows.some((row) => row.startsWith('# '))) missing.push('title')
  const required: [string, RegExp][] = [
    ['Goal', SEC.goal],
    ['Constraints', SEC.constraints],
    ['Interfaces', SEC.interfaces],
    ['Invariants', SEC.invariants],
    ['Tasks', SEC.tasks],
    ['Bugs', SEC.bugs],
    ['Repos', SEC.repos],
    ['Status', SEC.status],
    ['Closeout', SEC.closeout],
  ]
  for (const [name, pattern] of required) if (!rows.some((row) => pattern.test(row))) missing.push(name)
  return missing
}

export function closeoutLines(text: string): string[] {
  const rows = lines(text)
  const at = rows.findIndex((row) => SEC.closeout.test(row))
  return at < 0 ? [] : rows.slice(at)
}

export function zClosed(text: string): boolean {
  return closeoutLines(text).some(closureLine)
}

export function zColumn(text: string): string {
  const rows = closeoutLines(text)
  if (rows.some((row) => Z.complete.test(row))) return 'complete'
  if (rows.some((row) => Z.abandoned.test(row))) return 'abandoned'
  const hit = rows.map((row) => Z.successor.exec(row)?.[0]).find((match) => match !== undefined)
  if (hit === undefined) return '—'
  return `→${hit.replace(/^.*successor:[ \t\n\r\f\v]*/, '').replace(/[ \t\n\r\f\v]+$/, '')}`
}

export const STAMP = '[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}(?::[0-9]{2})?'
const ENTRY = new RegExp(`^(?:${STAMP} )?(ds:[a-z]+) (\\S+) (.*)$`)
const JOINED = new RegExp(` (?=${STAMP} ds:[a-z]+ )`)

export function statusSection(text: string): string[] {
  const out: string[] = []
  let inside = false
  for (const row of lines(text)) {
    if (SEC.any.test(row)) inside = SEC.status.test(row)
    else if (inside) out.push(row)
  }
  return out
}

export function openOps(entries: string[]): Map<string, string> {
  const open = new Map<string, string>()
  const pending = new Map<string, string>()
  for (const entry of entries.flatMap((line) => trim(line).split(JOINED))) {
    const match = ENTRY.exec(entry)
    if (!match) continue
    const [, verb = '', target = '', rest = ''] = match
    const key = `${verb} ${target}`
    const events = rest.split(/;[ \t]*/).map((part) => part.trim().split(/[ \t]+/)[0] ?? '')
    if (events.includes('START')) {
      open.set(key, entry)
      if (target === 'pending') pending.set(verb, key)
    }
    if (events.includes('DONE')) {
      open.delete(key)
      const parked = pending.get(verb)
      if (parked !== undefined) {
        open.delete(parked)
        pending.delete(verb)
      }
    }
  }
  return open
}

export function vmFindings(file: string, text: string): string[] {
  const out: string[] = []
  const status: string[] = []
  let sec = ''
  let header = false
  let colState = 0
  let colCite = 0
  for (const row of lines(text)) {
    if (SEC.any.test(row)) {
      if (SEC.status.test(row)) sec = 'S'
      else if (SEC.tasks.test(row)) {
        sec = 'T'
        header = false
        colState = 0
        colCite = 0
      } else sec = 'other'
      continue
    }
    if (sec === 'S') {
      const line = trim(row)
      if (line === '' || line.startsWith('<!--')) continue
      if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}/.test(line)) {
        out.push(`WARN Vm.2 ${file}: Status line missing ISO timestamp: ${line}`)
      }
      status.push(line)
    }
    if (sec === 'T') {
      if (!row.startsWith('|') || RULE_ROW.test(row)) continue
      const cells = row.split(CELL)
      if (!header) {
        header = true
        const named = columns(row, ['state', 'cite'])
        colState = named.state ?? 0
        colCite = named.cite ?? 0
        if (!colState || !colCite) {
          const missing = !colState && !colCite ? 'state or cite' : colState ? 'cite' : 'state'
          out.push(`WARN Vm.3 ${file}: Tasks header names no ${missing} column, so its rows go unchecked`)
        }
        continue
      }
      if (!colState || !colCite) continue
      const id = trim(cells[1] ?? '')
      const state = trim(cells[colState] ?? '')
      const cite = trim(cells[colCite] ?? '')
      if (id === 'id' || id === '') continue
      if (state === 'x' && (cite === '' || cite === '—' || cite === '-')) {
        out.push(`CRITICAL Vm.3 ${file}: Tasks row ${id} state=x has empty cite`)
      }
    }
  }
  for (const key of openOps(status).keys()) out.push(`WARN Vm.6 ${file}: Status ${key} START without DONE`)
  return out
}

export type IndexRow = { date: string; slug: string; state: string; row: string }

function taskCount(rows: string[]): { done: number; total: number; noState: boolean } {
  let header = false
  let colState = 0
  let done = 0
  let total = 0
  let noState = false
  for (const [, row, inside] of inSection(rows, SEC.tasks)) {
    if (SEC.tasks.test(row)) {
      header = false
      colState = 0
      continue
    }
    if (!inside) continue
    if (TASK_ROW.test(row)) total++
    if (!row.startsWith('|') || RULE_ROW.test(row)) continue
    if (!header) {
      header = true
      colState = columns(row, ['state']).state ?? 0
      if (!colState) noState = true
      continue
    }
    if (TASK_ROW.test(row) && colState && trim(row.split(CELL)[colState] ?? '') === 'x') done++
  }
  return { done, total, noState }
}

export function indexRow(dir: string, text: string, archived: boolean, mtime: string): IndexRow & { warning?: string } {
  const chars = [...dir]
  const date = chars.slice(0, 10).join('')
  const slug = chars.slice(11).join('')
  const rows = lines(text)
  const token = headerToken(text)
  const { done, total, noState } = taskCount(rows)
  let bugs = 0
  for (const [, row, inside] of inSection(rows, SEC.bugs)) if (inside && BUG_ROW.test(row)) bugs++
  const z = zColumn(text)
  const closed = z !== '—'
  let state: string
  if (archived) state = token === 'done' ? 'done' : 'drift!'
  else if (closed) state = 'drift!'
  else if (token === 'live' || token === 'paused') state = token
  else state = 'drift!'
  const row = `| ${date} | ${slug} | ${state} | ${done}/${total} | ${bugs} | ${mtime} | ${z} |`
  return { date, slug, state, row, ...(noState ? { warning: 'Tasks header names no state column, so its rows count as not-done' } : {}) }
}

const RANK: Record<string, number> = { 'drift!': 0, live: 1, paused: 2 }

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function renderIndex(rows: IndexRow[]): string {
  const sorted = [...rows].sort(
    (a, b) =>
      byCodeUnit(b.date, a.date) ||
      (RANK[a.state] ?? 3) - (RANK[b.state] ?? 3) ||
      byCodeUnit(a.row, b.row),
  )
  let out =
    '# .scratchpad index\n\n| date | slug | state | T | B | mtime | §Z |\n|------|------|-------|---|---|-------|-----|\n'
  out += sorted.map((row) => `${row.row}\n`).join('')
  const drift = rows.filter((row) => row.state === 'drift!')
  if (drift.length) out += `\n<!-- drift:${drift.length} slugs:${drift.map((row) => `${row.date}-${row.slug}`).join(' ')} -->\n`
  return out
}

export function changelogInsert(text: string, section: string): string {
  const out: string[] = []
  let done = false
  for (const row of lines(text)) {
    if (!done && row.startsWith('## ')) {
      out.push(`${section}`)
      done = true
    }
    out.push(row)
  }
  return done ? unlines(out) : `${unlines(out)}\n${section}`
}
