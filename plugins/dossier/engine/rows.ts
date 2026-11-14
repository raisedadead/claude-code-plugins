export const STATES = ['now', 'next', 'wait', 'later', 'done', 'drop'] as const
export type State = (typeof STATES)[number]
export type Who = 'A' | 'H'
export type Row = { id: string; state: State; who: Who; title: string; tail: string }
export type Bad = { line: number; text: string; why: string }
export type Trigger = { kind: 'until'; date: string } | { kind: 'after'; slug: string } | { kind: 'pr'; repo: string; number: number }

const ROW = /^- (O\d+) (now|next|wait|later|done|drop) ([AH]) (.+?)(?: · (.+))?$/
const ID_LINE = /^- O\d+\b/
const OTHER_ID = /\b[OTWVB]\d+\b/
export const TITLE_MAX = 80

export function idNumber(id: string): number {
  return Number(id.slice(1))
}

export function parseRow(text: string): Row | undefined {
  const found = ROW.exec(text)
  if (!found) return undefined
  const [, id = '', state = '', who = '', title = '', tail = ''] = found
  return { id, state: state as State, who: who as Who, title, tail }
}

export function formatRow(row: Row): string {
  return `- ${row.id} ${row.state} ${row.who} ${row.title}${row.tail ? ` · ${row.tail}` : ''}`
}

export function trigger(tail: string): Trigger | undefined {
  let found = /^until (\d{4}-\d{2}-\d{2})$/.exec(tail)
  if (found?.[1]) return { kind: 'until', date: found[1] }
  found = /^after pr ([\w.-]+\/[\w.-]+)#(\d+)$/.exec(tail)
  if (found?.[1] && found[2]) return { kind: 'pr', repo: found[1], number: Number(found[2]) }
  found = /^after ([a-z0-9][a-z0-9-]*)$/.exec(tail)
  if (found?.[1]) return { kind: 'after', slug: found[1] }
  return undefined
}

export function shapeErrors(row: Row): string[] {
  const errors: string[] = []
  if ([...row.title].length > TITLE_MAX) errors.push(`title is over ${TITLE_MAX} characters`)
  if (/\*\*|`/.test(row.title)) errors.push('title has bold or code marks')
  if (OTHER_ID.test(row.title)) errors.push('title names another ID; put it in the tail or the notes')
  if (row.state === 'later' && !trigger(row.tail))
    errors.push('a later row needs a tail: until <YYYY-MM-DD>, after <dossier-slug> or after pr <owner/repo>#<n>')
  if ((row.state === 'done' || row.state === 'drop') && !row.tail)
    errors.push(`a ${row.state} row needs a tail: the ${row.state === 'done' ? 'commit or decision' : 'reason'}`)
  return errors
}

export function scanRows(body: string, firstLine = 1): { rows: (Row & { line: number })[]; bad: Bad[] } {
  const rows: (Row & { line: number })[] = []
  const bad: Bad[] = []
  body.split('\n').forEach((text, index) => {
    const line = firstLine + index
    if (!text.trim()) return
    const row = parseRow(text)
    if (!row) {
      bad.push({ line, text, why: ID_LINE.test(text) ? 'row is out of shape: - O<N> <state> <A|H> <title> · <tail>' : 'not a row' })
      return
    }
    for (const why of shapeErrors(row)) bad.push({ line, text, why })
    rows.push({ ...row, line })
  })
  return { rows, bad }
}
