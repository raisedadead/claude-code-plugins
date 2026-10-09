import { cells } from './converge.ts'
import { splitLines } from './text.ts'

export type Count = { done: number; total: number }

export type Progress = {
  all: Count
  agent: Count
  operator: Count
  milestone?: Count & { id: string }
  active: string[]
  tail: string[]
  next: string[]
  waiting: string[]
}

export type Row = { id: string; state: string; who: string; task: string; needs: string[]; cite: string; verify: string }

const TASK_ID = /^T\d+$/
export const DELAYED = /^(T\d+)\+\d+d$/

export function taskRows(text: string): Row[] {
  const lines = splitLines(text)
  const start = lines.findIndex((line) => /^##\s+(§T\b|Tasks\b)/.test(line))
  if (start < 0) return []
  const rows: Row[] = []
  let names: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break
    const row = cells(line)
    if (!row.length) continue
    if (!names.length) {
      names = row.map((name) => name.toLowerCase())
      continue
    }
    const at = (name: string): string => row[names.indexOf(name)] ?? ''
    if (!TASK_ID.test(at('id'))) continue
    const needs = at('needs')
      .split(',')
      .map((need) => need.trim())
      .filter((need) => need && need !== '—' && need !== '-')
    rows.push({ id: at('id'), state: at('state'), who: at('who').toUpperCase(), task: at('task'), needs, cite: at('cite'), verify: at('verify') })
  }
  return rows
}

function count(rows: Row[]): Count {
  return { done: rows.filter((row) => row.state === 'x').length, total: rows.length }
}

export function progress(text: string, milestone?: string): Progress {
  const rows = taskRows(text)
  const done = new Set(rows.filter((row) => row.state === 'x').map((row) => row.id))
  const ready = (row: Row): boolean => row.state === '.' && row.needs.every((need) => !DELAYED.test(need) && done.has(need))
  const view: Progress = {
    all: count(rows),
    agent: count(rows.filter((row) => row.who === 'A')),
    operator: count(rows.filter((row) => row.who === 'H')),
    active: rows.filter((row) => row.state === '~').map((row) => row.id),
    tail: rows.flatMap((row) => (row.state === 'x' ? [] : row.needs.filter((need) => DELAYED.test(need)).map((need) => `${row.id} ${need}`))),
    next: rows.filter((row) => row.who === 'A' && ready(row)).map((row) => row.id),
    waiting: rows.filter((row) => row.who === 'H' && ready(row)).map((row) => row.id),
  }
  if (milestone !== undefined && rows.some((row) => row.id === milestone)) {
    const after = downstream(rows, milestone)
    view.milestone = { id: milestone, ...count(rows.filter((row) => !after.has(row.id))) }
  }
  return view
}

function downstream(rows: Row[], id: string): Set<string> {
  const after = new Set<string>()
  const reaches = (row: Row): boolean =>
    row.needs.some((need) => {
      const target = DELAYED.exec(need)?.[1] ?? need
      return target === id || after.has(target)
    })
  let grew = true
  while (grew) {
    grew = false
    for (const row of rows) {
      if (after.has(row.id) || !reaches(row)) continue
      after.add(row.id)
      grew = true
    }
  }
  return after
}

function percent({ done, total }: Count): string {
  return `${total ? Math.floor((done * 100) / total) : 0}%`
}

export function progressLine(slug: string, view: Progress): string {
  const head = `${slug} ${percent(view.all)} · ${view.all.done}/${view.all.total}`
  if (view.all.total && view.all.done === view.all.total) return `${head} · ready to close`
  const parts = [head]
  if (view.next[0]) parts.push(`next ${view.next[0]}`)
  if (view.waiting.length) parts.push(`waits on you: ${view.waiting.join(' ')}`)
  if (!view.next.length && !view.waiting.length && view.active.length) parts.push(`in progress ${view.active.join(' ')}`)
  return parts.join(' · ')
}

export function progressTable(slug: string, view: Progress): string {
  const rows: [string, Count][] = [
    ['Agent', view.agent],
    ['You', view.operator],
  ]
  if (view.milestone) rows.push([`Up to ${view.milestone.id}`, view.milestone])
  const width = Math.max(5, ...rows.map(([label]) => label.length))
  const out = [`${slug} · ${view.all.done} of ${view.all.total} done · ${percent(view.all)}`, '']
  out.push(`${'Owner'.padEnd(width)}  Done  Total  Share`)
  for (const [label, value] of rows) {
    out.push(`${label.padEnd(width)}  ${String(value.done).padEnd(4)}  ${String(value.total).padEnd(5)}  ${percent(value)}`)
  }
  if (view.active.length) out.push('', `In progress, not counted: ${view.active.join(' ')}`)
  if (view.tail.length) out.push(`After the milestone: ${view.tail.join(', ')}`)
  return out.join('\n')
}
