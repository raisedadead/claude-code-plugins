const DECISION = /^DECISION: (?:(\d+(?:\.\d+)*)\.? )?(.*)$/
const PROBE = /^ probe=(`[^`]*`|\S+)/
const ANSWER = /^ answer=(\S.*)$/

type Decision = {
  readonly id: string
  readonly label: string
  readonly recommended: string
  readonly probe: string
  readonly answer: string
  readonly stray: boolean
}

function decision(row: string): Decision | undefined {
  const match = DECISION.exec(row)
  if (!match) return undefined
  const id = match[1] ?? ''
  const body = match[2] ?? ''
  const at = body.indexOf(' recommended=')
  const label = id || (at >= 0 ? body.slice(0, at) : body) || '?'
  if (at < 0) return { id, label, recommended: '', probe: '', answer: '', stray: false }
  const tail = body.slice(at + ' recommended='.length)
  const probeAt = tail.indexOf(' probe=')
  if (probeAt < 0) {
    const answerAt = tail.indexOf(' answer=')
    const recommended = answerAt < 0 ? tail : tail.slice(0, answerAt)
    const answer = answerAt < 0 ? '' : (ANSWER.exec(tail.slice(answerAt))?.[1] ?? '')
    return { id, label, recommended, probe: '', answer, stray: false }
  }
  const probe = PROBE.exec(tail.slice(probeAt))?.[1] ?? ''
  const rest = tail.slice(probeAt + ' probe='.length + probe.length)
  const answer = ANSWER.exec(rest)?.[1] ?? ''
  return { id, label, recommended: tail.slice(0, probeAt), probe, answer, stray: rest !== '' && !answer }
}

export function openDecisions(rows: readonly string[]): string[] {
  const decisions = rows.flatMap((row) => decision(row) ?? [])
  const open: string[] = []
  for (const node of decisions) {
    if (!node.answer || /^"?pending"?$/.test(node.answer)) open.push(node.label)
    else if (/(?:^|→ )forked\b/.test(node.answer)) {
      const children = decisions.filter((child) => child.id.startsWith(`${node.id}.`))
      if (!node.id || !children.length) open.push(node.label)
    }
  }
  return open
}

export const FRONTIER_CLOSED = /^FRONTIER: (empty|empty-except-external n=[0-9]+)$/

export function entryError(entry: string): string | undefined {
  if (entry.includes('\n')) return 'an entry is one line'
  if (entry.startsWith('FACT: ')) return /\bcite=\S/.test(entry) ? undefined : 'a FACT needs cite=<file|command|url>'
  const node = decision(entry)
  if (node) {
    if (!/^\S/.test(node.recommended)) return 'a DECISION needs recommended=<option>'
    if (!node.probe) return 'a DECISION needs probe=<file:line|command|url|—> after recommended='
    if (node.stray) return 'a probe with spaces goes in backticks: probe=`<command>`'
    return undefined
  }
  if (FRONTIER_CLOSED.test(entry)) return undefined
  if (entry.startsWith('CONFIRMED: ')) return undefined
  return 'an entry starts with FACT:, DECISION:, FRONTIER: or CONFIRMED: — ds:new alone writes CONSUMED:'
}

export function addEntry(text: string, entry: string): string {
  const rows = text.split('\n')
  const id = decision(entry)?.id
  const same = id ? rows.findIndex((row) => decision(row)?.id === id) : -1
  if (same >= 0) {
    rows[same] = entry
    return rows.join('\n')
  }
  const draft = rows.findIndex((row) => row === '## Draft')
  if (draft < 0) return `${text.trimEnd()}\n\n${entry}\n`
  return `${rows.slice(0, draft).join('\n').trimEnd()}\n\n${entry}\n\n${rows.slice(draft).join('\n')}`
}
