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
const PAUSE = /^PAUSE reason=(.+)$/
const CI = /^ci:(.+)$/

function pauses(text: string): Map<string, string> {
  const latest = new Map<string, string>()
  const entries = statusSection(text).flatMap((line) => trim(line).split(JOINED))
  for (const entry of entries) {
    const found = BUILD_ENTRY.exec(trim(entry))
    if (found?.[1] && found[2] !== undefined) latest.set(found[1], found[2])
  }
  const paused = new Map<string, string>()
  for (const [id, event] of latest) {
    const reason = PAUSE.exec(event)?.[1]
    if (reason) paused.set(id, reason)
  }
  return paused
}

export function handoff(text: string, slug: string, stamp: string): string[] {
  const rows = taskRows(text)
  if (!rows.length) return ['operator: §T has no rows']
  const reasons = pauses(text)
  const ciRun = (id: string): string | undefined => CI.exec(reasons.get(id) ?? '')?.[1]
  const step =
    (label: string) =>
    (row: Row): string => {
      const run = ciRun(row.id)
      return run === undefined ? named(label)(row) : `ci: ${row.id} ${run}`
    }
  const held = rows.filter(({ id, who, state }) => who === 'A' && state !== 'x' && reasons.has(id) && ciRun(id) === undefined)
  const heldIds = new Set(held.map(({ id }) => id))
  const answers = held.map(({ id }) => `answer: ${id} PAUSE ${reasons.get(id)}`)
  const done = new Set(rows.filter(({ state }) => state === 'x').map(({ id }) => id))
  const ready = ({ state, needs }: Row, met: Set<string>): boolean => state === '.' && needs.every((need) => !DELAYED.test(need) && met.has(need))
  const operator = rows.filter((row) => row.who === 'H' && (row.state === '~' || ready(row, done)))
  const agent = rows.filter(({ id, who }) => who === 'A' && !heldIds.has(id))
  const paused = agent.filter(({ state }) => state === '~')
  if (paused.length || agent.some((row) => ready(row, done))) return [...answers, ...paused.map(named('paused')), ...goalLines(slug, stamp)]
  const later = agent.filter((row) => ready(row, new Set([...done, ...operator.map(({ id }) => id)])))
  if (later.length) {
    const needed = new Set(later.flatMap(({ needs }) => needs))
    return [...answers, ...operator.filter(({ id }) => needed.has(id)).map(step('after')), ...goalLines(slug, stamp)]
  }
  const asked = rows.filter(({ id, state }) => (state === '!' || state === '?') && !heldIds.has(id))
  const lines = [...operator.map(step('operator')), ...answers, ...asked.map(named('answer'))]
  if (lines.length) return lines
  const open = rows.filter(({ state }) => state !== 'x')
  const carry = open.filter(({ needs }) => needs.some((need) => DELAYED.test(need)))
  if (open.length === carry.length) {
    return [`close: ds close ${slug} --complete${carry.length ? ` --carry ${carry.map(({ id }) => id).join(',')}` : ''} --plan`]
  }
  return ['idle: no row is ready; ds progress shows why']
}
