import { indexNames, namedRows, openOps, SEC, statusSection, unpushedRepos } from './ledger.ts'
import { isDue, laterRows, laterSummary } from './later.ts'
import { ownerLine, progress, progressLine, taskRows } from './progress.ts'

export type SessionInput = {
  index?: string
  ledgers: { name: string; text: string; milestone?: string }[]
  source: string
  title: string
  titleFlag: string
  nudgeFlag: string
  notes?: string[]
  later?: string
  today?: string
}

export type SessionOutput = { context: string; title: string; system: string }

function filled(rows: string[]): string[] {
  return rows.filter((row) => !/^[ \t\n\r\f\v]*$/.test(row))
}

function resumeHints(name: string, text: string): string[] {
  return [...openOps(statusSection(text)).values()].map((row) => `  ⚠ resume needed [${name}]: ${row}`)
}

function stuckRows(text: string): string[] {
  return taskRows(text).flatMap((row) => {
    if (row.state === '!') return [`  ‼ blocked: ${row.id} ${row.task}`]
    if (row.state === '?') return [`  ? research: ${row.id} ${row.task}`]
    return []
  })
}

function repoSummary(text: string): string[] {
  const count = namedRows(text, SEC.repos).length
  return count ? [`repos ${count} · unpushed ${unpushedRepos(text).length}`] : []
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
    const live = indexNames(index, 'live')
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
    context.push(
      ...filled(statusSection(text))
        .slice(-2)
        .map((row) => `just did: ${row}`),
    )
    context.push('(ds:status for the dashboard)')
  }
  const today = input.today ?? ''
  context.push(...laterSummary(input.later, today))
  if (liveCount > 1) {
    system = `⚠ dossier: ${liveCount} live (${liveAll}) — run /dossier:status to consolidate (pause or close the stale ones).`
    context.push('', `⚠ ${liveCount} live dossiers: ${liveAll}— pick one, pause/close the rest (ds:status)`)
  }
  const due = laterRows(input.later).filter((row) => isDue(row, today))
  if (due.length && input.source !== 'compact') {
    const message = `dossier: carried work due — ${due.map((row) => row.key).join(' ')}. ds later lists it.`
    system = system ? `${system} ${message}` : message
  }
  if (driftCount > 0) {
    const message = `⚠ dossier: ${driftCount} in conflicting state (drift) — ${driftSlugs}. Run /dossier:status to reconcile.`
    system = system ? `${system} ${message}` : message
    context.push('', `⚠ drift (${driftCount}): ${driftSlugs} — header/Closeout/location disagreement, reconcile via ds:status`)
  }
  if (hints.length) context.push('', '## resume needed', ...hints, '(ds:status shows the task table)')
  if (input.notes?.length) context.push('', ...input.notes)
  return { context: context.join('\n').replace(/^\n+|\n+$/g, ''), title, system }
}
