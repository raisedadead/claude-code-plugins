import { createHash } from 'node:crypto'
import { type Row, scanRows } from './rows.ts'

export const SECTIONS = ['Goal', 'Scope', 'Decisions', 'Checks', 'Edge cases', 'Commits', 'Rows', 'Notes'] as const
export type Section = (typeof SECTIONS)[number]
export const CHECKED_SECTIONS: Section[] = ['Goal', 'Scope', 'Decisions', 'Checks', 'Edge cases', 'Commits']
export const HEADER_KEYS = ['state', 'branch', 'base', 'pr', 'checked', 'row'] as const
export type PlanState = 'plan' | 'build' | 'ship' | 'done'

export type Check = { name: string; command: string; expect: number; guard: boolean; rows: string[] }
export type Commit = { subject: string; rows: string[]; paths: string[] }
export type Edge = { text: string; refs: string[] }

export const SUBJECT = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\([^)]*\))?!?: \S/
export const SUBJECT_MAX = 50

export function template(slug: string, branch: string, base: string, id: string): string {
  return [
    `# ${slug}`,
    '',
    'state: plan',
    `branch: ${branch}`,
    `base: ${base}`,
    'pr: ',
    'checked: -',
    `row: ${id}`,
    '',
    '## Goal',
    '',
    '## Scope',
    '',
    '- in: ',
    '- out: ',
    '',
    '## Decisions',
    '',
    'confirmed: ',
    '',
    '## Checks',
    '',
    '| name | command | expect | guard | rows |',
    '|---|---|---|---|---|',
    '',
    '## Edge cases',
    '',
    '## Commits',
    '',
    '| subject | rows | paths |',
    '|---|---|---|',
    '',
    '## Rows',
    '',
    '## Notes',
    '',
  ].join('\n')
}

function headingIndex(all: string[], name: string): number {
  return all.findIndex((line) => line.trim() === `## ${name}`)
}

export function sectionRange(text: string, name: string): { start: number; end: number } | undefined {
  const all = text.split('\n')
  const at = headingIndex(all, name)
  if (at < 0) return undefined
  let end = at + 1
  while (end < all.length && !(all[end] ?? '').startsWith('## ')) end += 1
  return { start: at + 1, end }
}

export function section(text: string, name: string): string {
  const range = sectionRange(text, name)
  if (!range) return ''
  return text.split('\n').slice(range.start, range.end).join('\n').trim()
}

export function noteOf(text: string, id: string): string | undefined {
  const block = section(text, 'Notes')
    .split(/^### /m)
    .find((b) => b.startsWith(`${id}\n`))
  return block?.slice(id.length).trim() || undefined
}

export function replaceSection(text: string, name: string, body: string): string {
  const all = text.split('\n')
  const range = sectionRange(text, name)
  if (!range) return `${text.trimEnd()}\n\n## ${name}\n\n${body.trim()}\n`
  const next = ['', ...(body.trim() ? [body.trim(), ''] : [])]
  return [...all.slice(0, range.start), ...next, ...all.slice(range.end)].join('\n')
}

export function header(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) break
    const found = /^([a-z]+): ?(.*)$/.exec(line)
    if (found?.[1]) out[found[1]] = (found[2] ?? '').trim()
  }
  return out
}

export function setHeader(text: string, key: string, value: string): string {
  const all = text.split('\n')
  const stop = all.findIndex((line) => line.startsWith('## '))
  const limit = stop < 0 ? all.length : stop
  const at = all.slice(0, limit).findIndex((line) => line.startsWith(`${key}:`))
  if (at >= 0) all[at] = `${key}: ${value}`
  else {
    let last = 0
    all.slice(0, limit).forEach((line, index) => {
      if (/^[a-z]+:/.test(line)) last = index
    })
    all.splice(last + 1, 0, `${key}: ${value}`)
  }
  return all.join('\n')
}

export function cells(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return inner.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

export function table(body: string): string[][] {
  const rows = body.split('\n').filter((line) => line.trim().startsWith('|'))
  return rows.slice(2).map(cells)
}

const unquote = (cell: string): string => cell.replace(/^`(.*)`$/, '$1')
const ids = (cell: string): string[] => cell.match(/\bO\d+\b/g) ?? []

export function checks(text: string): { checks: Check[]; errors: string[] } {
  const out: Check[] = []
  const errors: string[] = []
  for (const row of table(section(text, 'Checks'))) {
    const [name = '', command = '', expect = '', guard = '', rows = ''] = row
    const exit = /^exit (\d+)$/.exec(expect)
    if (!name || !/^`.+`$/.test(command) || !exit || !/^(yes|no)$/.test(guard)) {
      errors.push(`check row is out of shape: | name | \`command\` | exit <n> | yes or no | rows | (${row.join(' | ')})`)
      continue
    }
    out.push({ name, command: unquote(command), expect: Number(exit[1]), guard: guard === 'yes', rows: ids(rows) })
  }
  return { checks: out, errors }
}

export function commits(text: string): Commit[] {
  return table(section(text, 'Commits')).map(([subject = '', rows = '', paths = '']) => ({
    subject: unquote(subject),
    rows: ids(rows),
    paths: paths.split(/\s+/).map(unquote).filter(Boolean),
  }))
}

export function edges(text: string): Edge[] {
  return section(text, 'Edge cases')
    .split('\n')
    .filter((line) => line.startsWith('- '))
    .map((line) => {
      const [left = '', right = ''] = line.slice(2).split(' → ')
      return { text: left.trim(), refs: right.split(/[\s,]+/).filter(Boolean) }
    })
}

export function rows(text: string): ReturnType<typeof scanRows> {
  const range = sectionRange(text, 'Rows')
  if (!range) return { rows: [], bad: [] }
  const body = text.split('\n').slice(range.start, range.end).join('\n')
  return scanRows(body, range.start + 1)
}

export function setRow(text: string, row: Row, render: string): string {
  const all = text.split('\n')
  const at = all.findIndex((line) => line.startsWith(`- ${row.id} `))
  if (at < 0) return text
  all[at] = render
  return all.join('\n')
}

export function appendRow(text: string, render: string): string {
  const range = sectionRange(text, 'Rows')
  if (!range) return replaceSection(text, 'Rows', render)
  const body = section(text, 'Rows')
  return replaceSection(text, 'Rows', body ? `${body}\n${render}` : render)
}

export function planHash(text: string): string {
  const hash = createHash('sha256')
  for (const name of CHECKED_SECTIONS) hash.update(`## ${name}\n${section(text, name).replace(/\s+$/gm, '')}\n`)
  return hash.digest('hex').slice(0, 12)
}

export function subjectErrors(subject: string): string[] {
  const errors: string[] = []
  if (!SUBJECT.test(subject)) errors.push(`"${subject}" is not a Conventional Commits subject`)
  if ([...subject].length > SUBJECT_MAX) errors.push(`"${subject}" is over ${SUBJECT_MAX} characters`)
  if (subject.endsWith('.')) errors.push(`"${subject}" ends with a period`)
  return errors
}

export function lint(text: string): string[] {
  const errors: string[] = []
  const head = header(text)
  for (const key of ['state', 'branch', 'base']) if (!head[key]) errors.push(`header: ${key} is empty`)
  if (!/^O\d+$/.test(head.row ?? '')) errors.push('header: row')
  if (head.pr) errors.push(...subjectErrors(head.pr).map((e) => `PR title: ${e}`))
  else errors.push('header: pr (the PR title) is empty')
  for (const name of SECTIONS) if (!sectionRange(text, name)) errors.push(`section ## ${name} is missing`)
  if (!section(text, 'Goal')) errors.push('Goal is empty')
  const scope = section(text, 'Scope')
  for (const side of ['in', 'out']) if (!new RegExp(`^- ${side}: \\S`, 'm').test(scope)) errors.push(`Scope: "- ${side}:" is empty`)
  const decisions = section(text, 'Decisions').split('\n')
  for (const line of decisions.filter((l) => /^\d+\. /.test(l))) {
    if (!/^\d+\. .+ — .+ · \d{4}-\d{2}-\d{2}$/.test(line) || / — \?( ·|$)/.test(line)) errors.push(`Decisions: open or out of shape: ${line}`)
  }
  if (!decisions.some((l) => /^confirmed: \S/.test(l))) errors.push('Decisions: no "confirmed:" line with the operator\'s words')
  const found = checks(text)
  errors.push(...found.errors)
  if (!found.checks.length && !found.errors.length) errors.push('Checks: no checks')
  const { rows: all, bad } = rows(text)
  errors.push(...bad.map((b) => `Rows line ${b.line}: ${b.why}: ${b.text}`))
  const rowIds = new Set(all.map((r) => r.id))
  const checkNames = new Set(found.checks.map((c) => c.name))
  for (const check of found.checks) for (const id of check.rows) if (!rowIds.has(id)) errors.push(`Checks: ${check.name} names ${id}, which is not a row`)
  for (const edge of edges(text)) {
    if (!edge.refs.length) errors.push(`Edge cases: "${edge.text}" is tied to no row or check`)
    for (const ref of edge.refs) if (!rowIds.has(ref) && !checkNames.has(ref)) errors.push(`Edge cases: "${edge.text}" names ${ref}, which is no row or check`)
  }
  const planned = commits(text)
  if (!planned.length) errors.push('Commits: no planned commits')
  const inCommit = new Map<string, number>()
  for (const commit of planned) {
    errors.push(...subjectErrors(commit.subject).map((e) => `Commits: ${e}`))
    if (!commit.rows.length) errors.push(`Commits: "${commit.subject}" has no rows`)
    if (!commit.paths.length) errors.push(`Commits: "${commit.subject}" has no paths`)
    for (const id of commit.rows) {
      if (!rowIds.has(id)) errors.push(`Commits: "${commit.subject}" names ${id}, which is not a row`)
      inCommit.set(id, (inCommit.get(id) ?? 0) + 1)
    }
    for (const other of planned) {
      if (other !== commit && other.subject.startsWith(commit.subject))
        errors.push(`Commits: "${commit.subject}" is a prefix of "${other.subject}"; autosquash would mix them`)
    }
  }
  for (const row of all) {
    const count = inCommit.get(row.id) ?? 0
    if (row.who === 'A' && ['now', 'next'].includes(row.state) && count === 0) errors.push(`Rows: ${row.id} is in no planned commit`)
    if (count > 1) errors.push(`Rows: ${row.id} is in ${count} planned commits`)
  }
  return errors
}
