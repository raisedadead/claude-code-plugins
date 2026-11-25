import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { header, planHash, rows as dossierRows } from './plan.ts'
import { type Bad, isPaused, type Row, scanRows, trigger } from './rows.ts'
import { run } from './sh.ts'
import { archivedNames, DATE, type Dossier, liveDossiers, read, readOr, registerFile, scratch, today, worklog, write } from './store.ts'

export type Flag = { id: string; title: string; where: string; why: string }
export type Live = { slug: string; state: string; counts: Record<string, number>; next?: string; replan: boolean }
export type Triage = { wait: Flag[]; paused: Flag[]; due: Flag[]; stale: Flag[]; shape: Flag[]; live: Live[] }

const STALE_DAYS = 3
export const LATER_HEAD = '<!-- Written by ds triage from the later rows. Edits here are lost. -->'

function registerRows(root: string): { rows: (Row & { line: number })[]; bad: Bad[] } {
  const text = readOr(registerFile(root))
  const all = text.split('\n')
  const at = all.findIndex((line) => line.trim() === '## Rows')
  if (at < 0) return { rows: [], bad: [] }
  let end = at + 1
  while (end < all.length && !(all[end] ?? '').startsWith('## ')) end += 1
  return scanRows(all.slice(at + 1, end).join('\n'), at + 2)
}

function daysBetween(a: string, b: string): number {
  return (Date.parse(b) - Date.parse(a)) / 86_400_000
}

function prMerged(repo: string, number: number, cwd: string): boolean | undefined {
  if (process.env.DS_NO_NETWORK) return undefined
  const done = run(['gh', 'pr', 'view', String(number), '--repo', repo, '--json', 'state', '--jq', '.state'], cwd, { timeoutMs: 5000 })
  return done.code === 0 ? done.out.trim() === 'MERGED' : undefined
}

export function fired(row: Row, root: string): string | undefined {
  const due = trigger(row.tail)
  if (!due) return 'no trigger in the grammar'
  if (due.kind === 'until') return due.date <= today() ? `date ${due.date} passed` : undefined
  if (due.kind === 'after') return archivedNames(root).some((name) => name.replace(DATE, '') === due.slug) ? `dossier ${due.slug} closed` : undefined
  return prMerged(due.repo, due.number, root) ? `PR ${due.repo}#${due.number} merged` : undefined
}

function lastTouch(lines: string[], id: string): string | undefined {
  const pattern = new RegExp(`\\b${id}\\b`)
  const hit = [...lines].reverse().find((line) => pattern.test(line))
  return hit?.slice(2, 12)
}

export function triage(root: string): Triage {
  const out: Triage = { wait: [], paused: [], due: [], stale: [], shape: [], live: [] }
  const sources: { where: string; rows: (Row & { line: number })[]; bad: Bad[]; dossier?: Dossier }[] = [{ where: 'OPEN-WORK.md', ...registerRows(root) }]
  for (const dossier of liveDossiers(root)) sources.push({ where: dossier.slug, ...dossierRows(read(dossier.file)), dossier })
  for (const source of sources) {
    const lines = source.dossier ? worklog(source.dossier) : []
    for (const bad of source.bad) out.shape.push({ id: `line ${bad.line}`, title: bad.text, where: source.where, why: bad.why })
    for (const row of source.rows) {
      const flag = { id: row.id, title: row.title, where: source.where }
      if (row.state === 'wait') (isPaused(row) ? out.paused : out.wait).push({ ...flag, why: row.tail || 'waits on the operator' })
      if (row.state === 'later') {
        const why = fired(row, root)
        if (why) out.due.push({ ...flag, why })
      }
      if (row.state === 'now' && source.dossier) {
        const touched = lastTouch(lines, row.id)
        if (!touched || daysBetween(touched, today()) >= STALE_DAYS)
          out.stale.push({ ...flag, why: touched ? `no worklog line since ${touched}` : 'no worklog line' })
      }
    }
    if (source.dossier) {
      const text = read(source.dossier.file)
      const head = header(text)
      const counts: Record<string, number> = {}
      for (const row of source.rows) counts[row.state] = (counts[row.state] ?? 0) + 1
      const next = source.rows.find((r) => r.who === 'A' && r.state === 'now') ?? source.rows.find((r) => r.who === 'A' && r.state === 'next')
      const replan = head.state !== 'plan' && head.checked !== planHash(text)
      out.live.push({ slug: source.dossier.slug, state: head.state ?? '?', counts, ...(next ? { next: `${next.id} ${next.title}` } : {}), replan })
    }
  }
  return out
}

export function writeLaterView(root: string): boolean {
  const file = join(scratch(root), 'LATER.md')
  if (existsSync(file) && !read(file).startsWith(LATER_HEAD)) return false
  const later = registerRows(root).rows.filter((row) => row.state === 'later')
  const body = later.map((row) => `- ${row.id} ${row.title} · ${row.tail}`)
  write(file, [LATER_HEAD, '', '# Later', '', ...(body.length ? body : ['None.'])].join('\n'))
  return true
}

function groupOf(out: string[], title: string, flags: Flag[]): void {
  if (!flags.length) return
  out.push(`${title}:`)
  for (const f of flags) out.push(`- ${f.id} ${f.title} (${f.where}; ${f.why})`)
}

export function renderStart(view: Triage): string {
  const out: string[] = []
  groupOf(out, 'Deferred and now due', view.due)
  groupOf(out, 'Out of shape', view.shape)
  const changed = view.live.filter((d) => d.replan)
  if (changed.length) out.push('Plan changed since its check:', ...changed.map((d) => `- ${d.slug}`))
  return out.join('\n')
}

export function render(view: Triage): string {
  const out: string[] = []
  const group = (title: string, flags: Flag[]): void => groupOf(out, title, flags)
  group('Waits on the operator', view.wait)
  group('Paused', view.paused)
  group('Deferred and now due', view.due)
  group('In progress with no recent work', view.stale)
  group('Out of shape', view.shape)
  if (view.live.length) {
    out.push('Live dossiers:')
    for (const d of view.live) {
      const counts = Object.entries(d.counts)
        .map(([state, n]) => `${n} ${state}`)
        .join(', ')
      out.push(`- ${d.slug}: ${d.state}; ${counts || 'no rows'}${d.next ? `; next ${d.next}` : ''}${d.replan ? '; the plan changed since its check' : ''}`)
    }
  }
  return out.length ? out.join('\n') : 'Nothing is hanging and no dossier is live.'
}
