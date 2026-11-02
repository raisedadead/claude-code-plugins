import { JOINED, statusSection } from './ledger.ts'
import { DELAYED, type Row } from './progress.ts'
import { splitLines } from './text.ts'

export const LATER_FILE = 'LATER.md'

export type LaterRow = { key: string; task: string; who: string; due?: string }

const TITLE = '# Carried work'
const LINE = /^- (\S+\/T\d+) · (.+) · (\S+?)(?: · due (\d{4}-\d{2}-\d{2}))?$/
const ORIGIN = /\(from (\S+) (T\d+)[,)]/
const DELAY = /^(T\d+)\+(\d+)d$/

function parse(line: string): LaterRow | undefined {
  const found = LINE.exec(line)
  if (!found) return undefined
  const [, key = '', task = '', who = '', due] = found
  return due ? { key, task, who, due } : { key, task, who }
}

export function laterRows(text: string | undefined): LaterRow[] {
  return splitLines(text ?? '').flatMap((line) => parse(line) ?? [])
}

function line(row: LaterRow): string {
  return `- ${row.key} · ${row.task} · ${row.who}${row.due ? ` · due ${row.due}` : ''}`
}

function trimmed(kept: readonly string[]): string[] {
  const body = [...kept]
  while (body.length && !body[body.length - 1]?.trim()) body.pop()
  return body
}

function written(kept: readonly string[]): string {
  return `${trimmed(kept).join('\n')}\n`
}

function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function doneDay(status: readonly string[], id: string): string | undefined {
  const done = new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) \\d{2}:\\d{2}(?::\\d{2})? ds:build ${id} (?:[^;]*; )?DONE →`)
  const entries = status.flatMap((entry) => entry.trim().split(JOINED))
  return entries.flatMap((entry) => done.exec(entry)?.[1] ?? []).pop()
}

export function carriedRow(wave: string, row: Row, status: readonly string[]): LaterRow {
  const origin = ORIGIN.exec(row.task)
  const key = origin ? `${origin[1]}/${origin[2]}` : `${wave}/${row.id}`
  const delay = row.needs.find((need) => DELAYED.test(need))
  const [, base = '', days = '0'] = (delay && DELAY.exec(delay)) || []
  const day = base ? doneDay(status, base) : undefined
  const due = day ? addDays(day, Number(days)) : undefined
  const who = delay ?? row.who
  return due ? { key, task: row.task, who, due } : { key, task: row.task, who }
}

const CLOSED = /^(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}(?::\d{2})? — closed$/m
const AFTER = /^after: (.+)$/m
const ITEM = /^(T\d+) (.+) \(([^()]+)\)$/
const LATER_DAYS = 30

export function archivedCarried(wave: string, text: string, today: string): LaterRow[] {
  const closed = CLOSED.exec(text)?.[1]
  const after = AFTER.exec(text)?.[1]
  if (!closed || !after || /^successor: /m.test(text) || addDays(closed, LATER_DAYS) < today) return []
  const status = statusSection(text)
  return after.split(/; (?=T\d+ )/).flatMap((item) => {
    const [, id = '', task = '', who = ''] = ITEM.exec(item.trim()) ?? []
    if (!id) return []
    const needs = DELAYED.test(who) ? [who] : []
    return [carriedRow(wave, { id, state: '.', who, task, needs, cite: '—', verify: '—' }, status)]
  })
}

export function addCarried(text: string | undefined, incoming: readonly LaterRow[]): { text: string; added: string[] } {
  const kept = text === undefined ? [TITLE, ''] : trimmed(splitLines(text))
  const keys = new Set(laterRows(text).map((row) => row.key))
  const fresh: LaterRow[] = []
  for (const row of incoming) {
    if (keys.has(row.key)) continue
    keys.add(row.key)
    fresh.push(row)
  }
  return { text: written([...kept, ...fresh.map(line)]), added: fresh.map((row) => row.key) }
}

export function removeLater(text: string | undefined, key: string): string | undefined {
  const all = splitLines(text ?? '')
  const kept = all.filter((entry) => parse(entry)?.key !== key)
  return kept.length === all.length ? undefined : written(kept)
}

export function isDue(row: LaterRow, today: string): boolean {
  return row.due !== undefined && row.due <= today
}

export function laterSummary(text: string | undefined, today: string): string[] {
  const rows = laterRows(text)
  if (!rows.length) return []
  const due = rows.filter((row) => isDue(row, today)).map((row) => `due: ${row.key} ${row.task}`)
  return [`later: ${rows.length} carried — ds later lists them`, ...due]
}
