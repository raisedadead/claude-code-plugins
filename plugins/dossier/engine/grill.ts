const DECISION = /^DECISION: (?:(\d+(?:\.\d+)*)\.? )?(.*)$/

type Decision = { id: string; answer: string; label: string }

function decision(row: string): Decision | undefined {
  const match = DECISION.exec(row)
  if (!match) return undefined
  const body = match[2] ?? ''
  const answer = /\banswer=(\S.*)$/.exec(body)?.[1] ?? ''
  return { id: match[1] ?? '', answer, label: match[1] || body.split(' recommended=')[0] || '?' }
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
  if (entry.startsWith('DECISION: ')) return / recommended=\S/.test(entry) ? undefined : 'a DECISION needs recommended=<option>'
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
