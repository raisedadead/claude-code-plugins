import { existsSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { defaultBase } from '../engine/branch.ts'
import { cells, replaceSection, section, template } from '../engine/plan.ts'
import { formatRow, type Row, type State, TITLE_MAX, type Who } from '../engine/rows.ts'
import { Refusal } from '../engine/sh.ts'
import { DATE, dossierHome, ledgerRoot, nextIds, now, read, readOr, REGISTER_HEAD, registerFile, scratch, takeIds, write } from '../engine/store.ts'
import { writeLaterView } from '../engine/triage.ts'
import type { Args } from './plan.ts'

// The first O number of the shared counter (DESIGN "One ID scheme").
const FIRST_ID = 190
const BACKUP = '.pre-migrate.md'
const UNTIL = /^\d{4}-\d{2}-\d{2}$/

type Draft = { state: State; who: Who; text: string; tail?: string; note: string[]; keep?: string }
type OldDossier = { dir: string; slug: string; text: string; rows: Draft[]; log: string[]; branch?: string; goal: string }

// The clauses of a cell, cut outside brackets and code spans: at ". ", ": ", "; " or " — ", each at least 12 characters.
function clauses(text: string): string[] {
  const out: string[] = []
  let depth = 0
  let code = false
  let start = 0
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === '`') code = !code
    else if (!code && ch === '(') depth += 1
    else if (!code && ch === ')') depth = Math.max(0, depth - 1)
    else if (code || depth > 0 || i - start < 12) continue
    else if (/[.:;]/.test(ch ?? '') && text[i + 1] === ' ') {
      out.push(text.slice(start, i))
      start = i + 2
    } else if (text.startsWith(' — ', i)) {
      out.push(text.slice(start, i))
      start = i + 3
    }
  }
  return [...out, text.slice(start)].map((c) => c.trim()).filter(Boolean)
}

const ID = /\b[OTWVB]\d+[a-z]*\b/
// An ID outside brackets carries meaning that removing it loses ("Only if T10 is NetBird").
const boundToId = (clause: string): boolean => ID.test(clause.replace(/\([^()]*\)/g, ''))

export function titleOf(text: string): string {
  const all = clauses(text.replace(/^(?:\((?:from|see) [^)]*\)\s*)+/, ''))
  const pick = all.find((clause) => !boundToId(clause)) ?? all[0] ?? ''
  const plain = pick
    .replace(/^\p{Ll}/u, (ch) => (pick === all[0] ? ch : ch.toUpperCase()))
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|`/g, '')
    .replace(new RegExp(ID.source, 'g'), '')
    .replace(/ · /g, ', ')
    .replace(/\((?:\s|,|\/|see|from|per|via|in|and)*\)/g, '')
    .replace(/\s+([),])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(?:[\s,]+(?:for|to|of|in|and|the|a|with|on|from|by|under|after|as|per))+$/i, '')
    .replace(/[\s,]+$/, '')
  if ([...plain].length <= TITLE_MAX) return plain || 'Migrated row'
  const cut = [...plain].slice(0, TITLE_MAX - 1).join('')
  return `${cut.slice(0, cut.lastIndexOf(' ') > 40 ? cut.lastIndexOf(' ') : cut.length).trimEnd()}…`
}

function registerDrafts(text: string, skipped: string[] = []): Draft[] {
  const lines = text.split('\n')
  const head = lines.findIndex((line) => line.trim().startsWith('|') && cells(line).some((c) => c.toLowerCase() === 'id'))
  const out: Draft[] = []
  if (head >= 0) {
    const names = cells(lines[head] ?? '').map((c) => c.toLowerCase())
    for (const line of lines.slice(head + 2)) {
      if (!line.trim().startsWith('|')) break
      const row = cells(line)
      const get = (name: string) => row[names.indexOf(name)] ?? ''
      const id = get('id')
      if (!/^[A-Z]\d+$/.test(id)) continue
      if (!get('state').toLowerCase().startsWith('open')) {
        skipped.push(
          get('state')
            .split(/[\s,(:;]/)[0]
            ?.toLowerCase() || 'empty',
        )
        continue
      }
      const who: Who = get('owner').toLowerCase() === 'operator' ? 'H' : 'A'
      const other = names.filter((n) => n !== 'id' && n !== 'item').map((n) => `- ${n}: ${get(n)}`)
      const keep = /^O\d+$/.test(id) ? id : undefined
      const was = keep ? 'Kept its ID in the migration.' : `Was ${id} in OPEN-WORK.md before the migration.`
      out.push({ state: who === 'H' ? 'wait' : 'next', who, text: get('item'), note: [was, '', get('item'), '', ...other], ...(keep ? { keep } : {}) })
    }
  }
  for (const line of head >= 0 ? [] : lines) {
    if (!line.startsWith('- ')) continue
    const bullet = line.slice(2)
    const deferred = /^deferred — until ([^:]+): (.+)$/.exec(bullet)
    if (deferred) {
      const [, until = '', body = ''] = deferred
      const date = UNTIL.test(until.trim())
      out.push({
        state: date ? 'later' : 'wait',
        who: 'A',
        text: body,
        ...(date ? { tail: `until ${until.trim()}` } : {}),
        note: [`Was a deferred line in OPEN-WORK.md before the migration.`, '', line],
      })
      continue
    }
    const marked = /^([A-Z]\d+) \[([AH])\] (.+)$/.exec(bullet)
    if (marked) {
      const [, id = '', who = 'A', body = ''] = marked
      out.push({ state: who === 'H' ? 'wait' : 'next', who: who as Who, text: body, note: [`Was ${id} in OPEN-WORK.md before the migration.`, '', line] })
      continue
    }
    out.push({ state: 'wait', who: 'H', text: bullet, note: ['Was an unnumbered line in OPEN-WORK.md before the migration.', '', line] })
  }
  return out
}

function laterDrafts(text: string): Draft[] {
  const out: Draft[] = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('- ')) continue
    const parts = line.slice(2).split(' · ')
    const [key = '', body = '', ...rest] = parts
    const who: Who = rest.includes('H') ? 'H' : 'A'
    const due = rest.map((part) => /^due (\d{4}-\d{2}-\d{2})/.exec(part)?.[1]).find(Boolean)
    out.push({
      state: due ? 'later' : who === 'H' ? 'wait' : 'next',
      who,
      text: body || key,
      ...(due ? { tail: `until ${due}` } : {}),
      note: [`Was ${key} in dossier/LATER.md before the migration.`, '', line],
    })
  }
  return out
}

// An old heading: "## Goal", "## §G — Goal" or "## §S — Rolling status log".
function oldSection(text: string, word: string, mark: string): string {
  const lines = text.split('\n')
  const at = lines.findIndex((line) => {
    const head = /^## (.+)$/.exec(line.trim())?.[1]?.trim()
    if (!head) return false
    const rest = head.replace(/^§\w+\s*(?:—\s*)?/, '')
    return head === mark || rest.toLowerCase().startsWith(word.toLowerCase())
  })
  if (at < 0) return ''
  let end = at + 1
  while (end < lines.length && !(lines[end] ?? '').startsWith('## ')) end += 1
  return lines
    .slice(at + 1, end)
    .join('\n')
    .trim()
}

// The branch the old dossier worked on: the first repo table row with a branch cell.
function oldBranch(text: string): string | undefined {
  const lines = text.split('\n')
  for (let at = 0; at < lines.length; at += 1) {
    const names = (lines[at] ?? '').trim().startsWith('|') ? cells(lines[at] ?? '').map((c) => c.toLowerCase()) : []
    if (!names.includes('repo') || !names.includes('branch')) continue
    for (const line of lines.slice(at + 2)) {
      if (!line.trim().startsWith('|')) break
      const branch = (cells(line)[names.indexOf('branch')] ?? '').replace(/`/g, '').trim()
      if (/^[\w./-]+$/.test(branch) && branch !== '—') return branch
    }
  }
  return undefined
}

const OLD_STATE: Record<string, State | undefined> = { '.': 'next', '~': 'now', '!': 'wait', '?': 'wait' }

function oldDossier(dir: string, slug: string): OldDossier {
  const text = read(join(dir, 'DOSSIER.md'))
  const lines = text.split('\n')
  const head = lines.findIndex((line) => {
    const names = line.trim().startsWith('|') ? cells(line).map((c) => c.toLowerCase()) : []
    return names.includes('id') && names.includes('state') && (names.includes('task') || names.includes('item'))
  })
  const rows: Draft[] = []
  if (head >= 0) {
    const names = cells(lines[head] ?? '').map((c) => c.toLowerCase())
    const body = names.includes('task') ? 'task' : 'item'
    for (const line of lines.slice(head + 2)) {
      if (!line.trim().startsWith('|')) break
      const row = cells(line)
      const get = (name: string) => row[names.indexOf(name)] ?? ''
      const id = get('id')
      const state = OLD_STATE[get('state')] ?? (get('state') === 'x' || get('state') === '-' ? undefined : 'wait')
      if (!state) continue
      const other = names.filter((n) => !['id', 'state', 'who', body].includes(n)).map((n) => `- ${n}: ${get(n)}`)
      rows.push({
        state,
        who: get('who') === 'H' ? 'H' : 'A',
        text: get(body),
        note: [`Was ${id} in the plan before the migration.`, '', get(body), '', ...other],
      })
    }
  }
  const status = oldSection(text, 'Status', '§S') || oldSection(text, 'Rolling status', '§S')
  const log = status
    .split(/\n\s*\n/)
    .map((para) => para.trim().replace(/\s+/g, ' '))
    .filter((para) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} /.test(para))
    .map((para) => `- ${para}`)
  const branch = oldBranch(text)
  return { dir, slug, text, rows, log, goal: oldSection(text, 'Goal', '§G'), ...(branch ? { branch } : {}) }
}

function closedSlugs(root: string): Set<string> {
  const closed = new Set<string>()
  const index = readOr(join(scratch(root), 'INDEX.md'))
  const lines = index.split('\n')
  const head = lines.findIndex((line) => line.trim().startsWith('|') && cells(line).includes('slug'))
  if (head < 0) return closed
  const names = cells(lines[head] ?? '')
  for (const line of lines.slice(head + 2)) {
    if (!line.trim().startsWith('|')) continue
    const row = cells(line)
    const end = row[names.indexOf('§Z')] ?? ''
    if (end && end !== '—') closed.add(`${row[names.indexOf('date')] ?? ''}-${row[names.indexOf('slug')] ?? ''}`)
  }
  return closed
}

function notes(blocks: [string, string[]][]): string {
  return blocks.map(([id, lines]) => [`### ${id}`, ...lines].join('\n')).join('\n\n')
}

export function cmdMigrate(cwd: string, args: Args): string {
  const root = ledgerRoot(cwd)
  const dry = Boolean(args.flags['dry-run'])
  const register = registerFile(root)
  const oldRegister = existsSync(register) && !/^## Rows$/m.test(read(register))
  const later = join(dossierHome(root), 'LATER.md')
  const oldLater = existsSync(later)
  const index = join(scratch(root), 'INDEX.md')
  const closed = closedSlugs(root)
  const home = dossierHome(root)
  const folders = existsSync(home) ? readdirSync(home).filter((name) => DATE.test(name) && existsSync(join(home, name, 'DOSSIER.md'))) : []
  const old = folders.filter((name) => !/^state: /m.test(read(join(home, name, 'DOSSIER.md'))))
  const archive = old.filter((name) => closed.has(name))
  const convert = old.filter((name) => !archive.includes(name)).map((name) => oldDossier(join(home, name), name.replace(DATE, '')))

  const skipped: string[] = []
  const loose = [...(oldRegister ? registerDrafts(read(register), skipped) : []), ...(oldLater ? laterDrafts(read(later)) : [])]
  const total = loose.filter((d) => !d.keep).length + convert.reduce((n, d) => n + d.rows.length, 0)
  if (!oldRegister && !oldLater && !old.length && !existsSync(index)) return 'MIGRATE: nothing to do'
  // Every name this run creates is checked before the first write, so a refusal leaves the repo as it was.
  const backups = [
    ...(oldRegister ? [register.replace(/\.md$/, BACKUP)] : []),
    ...(oldLater ? [later.replace(/\.md$/, BACKUP)] : []),
    ...(existsSync(index) ? [index.replace(/\.md$/, BACKUP)] : []),
    ...convert.map((d) => join(d.dir, `DOSSIER${BACKUP}`)),
    ...archive.map((name) => join(home, '_archive', name)),
  ].filter((path) => existsSync(path))
  if (backups.length)
    throw new Refusal(
      `${backups.join(', ')} already exist${backups.length === 1 ? 's' : ''}; move ${backups.length === 1 ? 'it' : 'them'} aside, then run ds migrate again`,
    )
  const ids = dry ? nextIds(root, total, FIRST_ID) : takeIds(root, total, FIRST_ID)
  let at = 0
  const place = (drafts: Draft[]) =>
    drafts.map((draft) => {
      const id = draft.keep ?? ids[at++]
      if (!id) throw new Error('ds migrate: fewer IDs than rows')
      const row: Row = { id, state: draft.state, who: draft.who, title: titleOf(draft.text), tail: draft.tail ?? '' }
      return { row, note: [id, draft.note] as [string, string[]] }
    })
  const out: string[] = []

  const placed = place(loose)
  if (placed.length || oldRegister) {
    const before = existsSync(register) ? read(register) : ''
    let text = oldRegister || !before ? REGISTER_HEAD : before
    text = replaceSection(text, 'Rows', [section(text, 'Rows'), ...placed.map((p) => formatRow(p.row))].filter(Boolean).join('\n'))
    text = replaceSection(text, 'Notes', [section(text, 'Notes'), notes(placed.map((p) => p.note))].filter(Boolean).join('\n\n'))
    const counts = [...new Set(skipped)].map((state) => `${skipped.filter((s) => s === state).length} ${state}`).join(', ')
    out.push(
      `OPEN-WORK.md: ${placed.length} rows${skipped.length ? `; ${skipped.length} closed rows left in the backup (${counts})` : ''}${oldRegister ? `; old file kept as OPEN-WORK${BACKUP}` : ''}`,
      ...placed.map((p) => `  ${formatRow(p.row)}`),
    )
    if (!dry) {
      if (oldRegister) renameSync(register, register.replace(/\.md$/, BACKUP))
      write(register, text)
    }
  }
  if (oldLater) {
    out.push(`dossier/LATER.md: kept as dossier/LATER${BACKUP}`)
    if (!dry) renameSync(later, later.replace(/\.md$/, BACKUP))
  }
  for (const dossier of convert) {
    const rows = place(dossier.rows)
    const quoted = dossier.goal
      .split('\n')
      .map((line) => (line ? `> ${line}` : '>'))
      .join('\n')
    const base = defaultBase(root)
    const branch = dossier.branch && dossier.branch !== base ? dossier.branch : dossier.slug
    let text = template(dossier.slug, branch, base)
    text = replaceSection(text, 'Goal', quoted)
    text = replaceSection(text, 'Rows', rows.map((p) => formatRow(p.row)).join('\n'))
    const kept = `### Before the migration\n\nThe plan before the migration is in DOSSIER${BACKUP} beside this file, with its done tasks, its other sections and its status log. Run /dossier:plan to fill in Scope, Decisions, Checks and Commits.`
    text = replaceSection(text, 'Notes', [kept, notes(rows.map((p) => p.note))].filter(Boolean).join('\n\n'))
    out.push(
      `${dossier.slug}: plan state on branch ${branch}, ${rows.length} rows, ${dossier.log.length} log lines; old file kept as DOSSIER${BACKUP}`,
      ...rows.map((p) => `  ${formatRow(p.row)}`),
    )
    if (!dry) {
      const file = join(dossier.dir, 'DOSSIER.md')
      write(join(dossier.dir, `DOSSIER${BACKUP}`), dossier.text)
      write(file, text)
      const worklog = join(dossier.dir, 'worklog.md')
      const before = readOr(worklog, `# Worklog: ${dossier.slug}\n\n`)
      write(worklog, [before.trimEnd(), ...dossier.log, `- ${now()} migrate from the old plan; ${rows.length} rows`].join('\n'))
    }
  }
  for (const name of archive) {
    out.push(`${name}: closed in INDEX.md; moved to _archive/ unchanged`)
    if (!dry) {
      const target = join(home, '_archive', name)
      write(join(home, '_archive', '.keep'), '')
      renameSync(join(home, name), target)
    }
  }
  if (existsSync(index)) {
    out.push(`INDEX.md: kept as INDEX${BACKUP}`)
    if (!dry) renameSync(index, index.replace(/\.md$/, BACKUP))
  }
  if (!dry) writeLaterView(root)
  out.unshift(`MIGRATE${dry ? ' (dry run)' : ''}: ${total} rows, ${ids[0] ?? '-'} to ${ids[ids.length - 1] ?? '-'}`)
  return out.join('\n')
}
