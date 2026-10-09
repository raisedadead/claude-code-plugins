import { openOps, SEC } from './ledger.ts'
import { ownerLine, progress, progressLine, taskRows } from './progress.ts'

export type SessionInput = {
  index?: string
  ledgers: { name: string; text: string; milestone?: string }[]
  source: string
  title: string
  titleFlag: string
  nudgeFlag: string
  notes?: string[]
}

export type SessionOutput = { context: string; title: string; system: string }

const RULE = /^\|[ :|-]+$/

function trim(text: string): string {
  return text.replace(/^[ \t]+|[ \t]+$/g, '')
}

function textLines(text: string): string[] {
  const rows = text.split('\n')
  if (rows[rows.length - 1] === '') rows.pop()
  return rows
}

function sectionLines(text: string, pattern: RegExp): string[] {
  const out: string[] = []
  let inside = false
  for (const row of textLines(text)) {
    if (pattern.test(row)) {
      inside = true
      continue
    }
    if (inside && SEC.any.test(row)) inside = false
    if (inside) out.push(row)
  }
  return out
}

function filled(rows: string[]): string[] {
  return rows.filter((row) => !/^[ \t\n\r\f\v]*$/.test(row))
}

function liveNames(index: string): string[] {
  const rows = textLines(index).filter((row) => row.startsWith('|'))
  const names = (rows[0] ?? '').split('|').map(trim)
  const [date, slug, state] = ['date', 'slug', 'state'].map((name) => names.indexOf(name))
  return rows
    .slice(1)
    .map((row) => row.split('|').map(trim))
    .filter((cells) => cells[state ?? -1] === 'live')
    .map((cells) => `${cells[date ?? -1] ?? ''}-${cells[slug ?? -1] ?? ''}`)
}

function resumeHints(name: string, text: string): string[] {
  return [...openOps(sectionLines(text, SEC.status)).values()].map((row) => `  ⚠ resume needed [${name}]: ${row}`)
}

function stuckRows(text: string): string[] {
  return taskRows(text).flatMap((row) => {
    if (row.state === '!') return [`  ‼ blocked: ${row.id} ${row.task}`]
    if (row.state === '?') return [`  ? research: ${row.id} ${row.task}`]
    return []
  })
}

function repoSummary(text: string): string[] {
  let inside = false
  let header = false
  let count = 0
  let unpushed = 0
  for (const row of textLines(text)) {
    if (SEC.repos.test(row)) {
      inside = true
      continue
    }
    if (SEC.any.test(row)) inside = false
    if (!inside || !row.startsWith('|') || RULE.test(row)) continue
    if (!header) {
      header = true
      continue
    }
    count++
    if (trim(row.split('|')[5] ?? '') === 'no') unpushed++
  }
  return count ? [`repos ${count} · unpushed ${unpushed}`] : []
}

export function sessionReport(input: SessionInput): SessionOutput {
  const context: string[] = []
  const index = input.index
  let liveSlug = ''
  let liveCount = 0
  let liveAll = ''
  let driftCount = 0
  let driftSlugs = ''
  if (index !== undefined) {
    const live = liveNames(index)
    liveSlug = live[0] ?? ''
    liveCount = live.length
    liveAll = live.map((name) => `${name} `).join('')
    const drift = /<!-- drift:[0-9]+ slugs:[^>\n]*-->/.exec(index)?.[0]
    if (drift) {
      driftCount = Number(/drift:([0-9]+)/.exec(drift)?.[1] ?? 0)
      driftSlugs = drift.replace(/.*slugs:(.*) -->/, '$1')
    }
  }
  const hints = input.ledgers.flatMap((ledger) => resumeHints(ledger.name, ledger.text))
  let title = ''
  if (input.titleFlag === '1' && ['startup', 'resume', 'fork'].includes(input.source) && !input.title && liveSlug) {
    title = liveSlug
  }
  const wave = input.ledgers.find((ledger) => ledger.name === liveSlug)
  const view = wave ? progress(wave.text, wave.milestone) : undefined
  const lead = view ? `dossier live: ${progressLine(liveSlug, view)}` : `dossier live: ${liveSlug}`
  let system = ''
  if (liveCount === 1 && liveSlug && input.nudgeFlag !== '0' && input.source !== 'compact') {
    system = `${lead} — /dossier:status for the sit-rep.`
  }
  const text = wave?.text
  if (liveSlug && text !== undefined && view) {
    context.push(lead, ownerLine(view), ...stuckRows(text), ...repoSummary(text))
    context.push(...filled(sectionLines(text, SEC.status)).slice(-2).map((row) => `just did: ${row}`))
    context.push('(ds:status for the dashboard)')
  }
  if (liveCount > 1) {
    system = `⚠ dossier: ${liveCount} live (${liveAll}) — run /dossier:status to consolidate (pause or close the stale ones).`
    context.push('', `⚠ ${liveCount} live dossiers: ${liveAll}— pick one, pause/close the rest (ds:status)`)
  }
  if (driftCount > 0) {
    const message = `⚠ dossier: ${driftCount} in conflicting state (drift) — ${driftSlugs}. Run /dossier:status to reconcile.`
    system = system ? `${system} ${message}` : message
    context.push('', `⚠ drift (${driftCount}): ${driftSlugs} — header/Closeout/location disagreement, reconcile via ds:status`)
  }
  if (hints.length) context.push('', '## resume needed', ...hints)
  if (text !== undefined && hints.some((hint) => hint.includes(`[${liveSlug}]`))) {
    context.push('', '### Tasks (resume context)', ...filled(sectionLines(text, SEC.tasks)), '### Repos', ...filled(sectionLines(text, SEC.repos)))
  }
  if (input.notes?.length) context.push('', ...input.notes)
  return { context: context.join('\n').replace(/^\n+|\n+$/g, ''), title, system }
}
