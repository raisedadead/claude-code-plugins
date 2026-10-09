import { openOps, SEC } from './ledger.ts'

export type SessionInput = {
  index?: string
  ledgers: { name: string; text: string }[]
  source: string
  title: string
  titleFlag: string
  nudgeFlag: string
}

export type SessionOutput = { context: string; title: string; system: string }

const RULE = /^\|[ :|-]+$/
const TASK = /^\| *T[0-9]+ *\|/

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

function liveRows(index: string): string[][] {
  return textLines(index)
    .slice(2)
    .map((row) => row.split('|'))
    .filter((cells) => trim(cells[3] ?? '') === 'live')
}

function resumeHints(name: string, text: string): string[] {
  return [...openOps(sectionLines(text, SEC.status)).values()].map((row) => `  ⚠ resume needed [${name}]: ${row}`)
}

function taskSummary(text: string): string[] {
  let inside = false
  let header = false
  let state = 0
  let task = 0
  let total = 0
  let done = 0
  let progress = 0
  const blocked: string[] = []
  const research: string[] = []
  for (const row of textLines(text)) {
    if (SEC.tasks.test(row)) {
      inside = true
      header = false
      state = 0
      task = 0
      continue
    }
    if (SEC.any.test(row)) inside = false
    if (!inside) continue
    const cells = row.split('|')
    if (row.startsWith('|') && !RULE.test(row) && !header) {
      header = true
      for (let i = 1; i < cells.length; i++) {
        if (trim(cells[i] ?? '') === 'state') state = i
        if (trim(cells[i] ?? '') === 'task') task = i
      }
      continue
    }
    if (header && state && task && TASK.test(row)) {
      const value = trim(cells[state] ?? '')
      total++
      if (value === 'x') done++
      else if (value === '~') progress++
      else if (value === '!') blocked.push(trim(cells[task] ?? ''))
      else if (value === '?') research.push(trim(cells[task] ?? ''))
    }
  }
  if (!total) return []
  let line = `Tasks: ${done}/${total} done`
  if (progress) line += `, ${progress} in-progress`
  if (blocked.length) line += `, ${blocked.length} blocked`
  if (research.length) line += `, ${research.length} need-research`
  return [line, ...blocked.map((item) => `  ‼ blocked: ${item}`), ...research.map((item) => `  ? research: ${item}`)]
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
  return count ? [`Repos: ${count} repos, ${unpushed} unpushed`] : []
}

export function sessionReport(input: SessionInput): SessionOutput {
  const context: string[] = []
  const index = input.index
  let liveSlug = ''
  let liveMeta = ''
  let liveCount = 0
  let liveAll = ''
  let driftCount = 0
  let driftSlugs = ''
  if (index !== undefined) {
    context.push('## .scratchpad/INDEX.md (head)', ...textLines(index).slice(0, 6))
    const live = liveRows(index)
    const first = live[0]
    if (first) {
      liveSlug = `${trim(first[1] ?? '')}-${trim(first[2] ?? '')}`
      liveMeta = trim(first[4] ?? '')
      if (trim(first[5] ?? '')) liveMeta += ` · T ${trim(first[5] ?? '')}`
      if (trim(first[6] ?? '')) liveMeta += ` · B ${trim(first[6] ?? '')}`
    }
    liveCount = live.length
    liveAll = live.map((cells) => `${trim(cells[1] ?? '')}-${trim(cells[2] ?? '')} `).join('')
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
  let system = ''
  if (liveCount === 1 && liveSlug && input.nudgeFlag !== '0' && input.source !== 'compact') {
    system = `dossier live: ${liveSlug}${liveMeta ? ` · ${liveMeta}` : ''} — /dossier:status for the sit-rep.`
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
  const text = input.ledgers.find((ledger) => ledger.name === liveSlug)?.text
  if (liveSlug && text !== undefined) {
    context.push('', `## dossier live: ${liveSlug}`, ...taskSummary(text), ...repoSummary(text))
    context.push(...filled(sectionLines(text, SEC.status)).slice(-2).map((row) => `just did: ${row}`))
    if (hints.some((hint) => hint.includes(`[${liveSlug}]`))) {
      context.push(
        '',
        `⚠ current dossier ${liveSlug} has an unfinished op — see 'resume needed' above`,
        '### Tasks (full — resume context)',
        ...filled(sectionLines(text, SEC.tasks)),
        '### Repos (full)',
        ...filled(sectionLines(text, SEC.repos)),
      )
    }
    context.push('(ds:status for full dashboard)')
  }
  return { context: context.join('\n').replace(/\n+$/, ''), title, system }
}
