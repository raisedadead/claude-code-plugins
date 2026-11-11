import { DELAYED, type Row, taskRows } from './progress.ts'

function goalLines(slug: string, stamp: string): string[] {
  return [
    `/goal ds:build --auto printed DONE or PAUSE for ${slug}, and §S records a matching auto-stop or PAUSE line stamped at or after ${stamp}.`,
    '/dossier:build --auto',
  ]
}

const named =
  (label: string) =>
  ({ id, task }: Row): string =>
    `${label}: ${id} ${task}`

export function handoff(text: string, slug: string, stamp: string): string[] {
  const rows = taskRows(text)
  if (!rows.length) return ['operator: §T has no rows']
  const done = new Set(rows.filter(({ state }) => state === 'x').map(({ id }) => id))
  const ready = ({ state, needs }: Row, met: Set<string>): boolean => state === '.' && needs.every((need) => !DELAYED.test(need) && met.has(need))
  const operator = rows.filter((row) => row.who === 'H' && (row.state === '~' || ready(row, done)))
  const agent = rows.filter(({ who }) => who === 'A')
  const paused = agent.filter(({ state }) => state === '~')
  if (paused.length || agent.some((row) => ready(row, done))) return [...paused.map(named('paused')), ...goalLines(slug, stamp)]
  const later = agent.filter((row) => ready(row, new Set([...done, ...operator.map(({ id }) => id)])))
  if (later.length) {
    const needed = new Set(later.flatMap(({ needs }) => needs))
    return [...operator.filter(({ id }) => needed.has(id)).map(named('after')), ...goalLines(slug, stamp)]
  }
  const lines = [...operator.map(named('operator')), ...rows.filter(({ state }) => state === '!' || state === '?').map(named('answer'))]
  if (lines.length) return lines
  const open = rows.filter(({ state }) => state !== 'x')
  const carry = open.filter(({ needs }) => needs.some((need) => DELAYED.test(need)))
  if (open.length === carry.length) {
    return [`close: ds close ${slug} --complete${carry.length ? ` --carry ${carry.map(({ id }) => id).join(',')}` : ''} --plan`]
  }
  return ['idle: no row is ready; ds progress shows why']
}
