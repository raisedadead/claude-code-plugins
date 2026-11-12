import { DELAYED, type Row, taskRows } from './progress.ts'
import { JOINED, STAMP, statusSection, trim } from './ledger.ts'

function goalLines(slug: string, stamp: string): string[] {
  return [`/goal §S of ${slug} records a ds:build PAUSE or auto-stop line stamped after ${stamp}.`, '/dossier:build --auto']
}

const named =
  (label: string) =>
  ({ id, task }: Row): string =>
    `${label}: ${id} ${task}`

const BUILD_ENTRY = new RegExp(`^${STAMP} ds:build (\\S+) (.*)$`)
const CI_PAUSE = /^PAUSE reason=ci:(.+)$/

function ciFailures(text: string): Map<string, string> {
  const latest = new Map<string, string>()
  const entries = statusSection(text).flatMap((line) => trim(line).split(JOINED))
  for (const entry of entries) {
    const found = BUILD_ENTRY.exec(trim(entry))
    if (found?.[1] && found[2] !== undefined) latest.set(found[1], found[2])
  }
  const failed = new Map<string, string>()
  for (const [id, event] of latest) {
    const detail = CI_PAUSE.exec(event)?.[1]
    if (detail) failed.set(id, detail)
  }
  return failed
}

export function handoff(text: string, slug: string, stamp: string): string[] {
  const rows = taskRows(text)
  if (!rows.length) return ['operator: §T has no rows']
  const failed = ciFailures(text)
  const step =
    (label: string) =>
    (row: Row): string => {
      const run = failed.get(row.id)
      return run === undefined ? named(label)(row) : `ci: ${row.id} ${run}`
    }
  const done = new Set(rows.filter(({ state }) => state === 'x').map(({ id }) => id))
  const ready = ({ state, needs }: Row, met: Set<string>): boolean => state === '.' && needs.every((need) => !DELAYED.test(need) && met.has(need))
  const operator = rows.filter((row) => row.who === 'H' && (row.state === '~' || ready(row, done)))
  const agent = rows.filter(({ who }) => who === 'A')
  const paused = agent.filter(({ state }) => state === '~')
  if (paused.length || agent.some((row) => ready(row, done))) return [...paused.map(named('paused')), ...goalLines(slug, stamp)]
  const later = agent.filter((row) => ready(row, new Set([...done, ...operator.map(({ id }) => id)])))
  if (later.length) {
    const needed = new Set(later.flatMap(({ needs }) => needs))
    return [...operator.filter(({ id }) => needed.has(id)).map(step('after')), ...goalLines(slug, stamp)]
  }
  const lines = [...operator.map(step('operator')), ...rows.filter(({ state }) => state === '!' || state === '?').map(named('answer'))]
  if (lines.length) return lines
  const open = rows.filter(({ state }) => state !== 'x')
  const carry = open.filter(({ needs }) => needs.some((need) => DELAYED.test(need)))
  if (open.length === carry.length) {
    return [`close: ds close ${slug} --complete${carry.length ? ` --carry ${carry.map(({ id }) => id).join(',')}` : ''} --plan`]
  }
  return ['idle: no row is ready; ds progress shows why']
}
