import { namedRows, SEC, STAMP, statusSection, trim } from './ledger.ts'

export type DelegationReport = { failures: string[]; delegated: number }

const PI_MARKER = /(^|\s)route=pi(?=$|[\s;,.)])/
const DELEGATE_MARKER = /(^|\s)route=delegate(?=$|[\s;,.)])/
const APPROVED = /^route=pi approved="[^"]+"/

function escaped(id: string): string {
  return id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function rowLines(status: string[], id: string): string[] {
  const entry = new RegExp(`^(?:${STAMP} )?ds:build ${escaped(id)} (.*)$`)
  const entries = status.flatMap((line) => trim(line).split(new RegExp(`(?=${STAMP} ds:build )`)))
  return entries.flatMap((line) => entry.exec(trim(line))?.[1] ?? [])
}

export function delegationReport(text: string): DelegationReport {
  const status = statusSection(text)
  const failures: string[] = []
  let delegated = 0
  for (const row of namedRows(text, SEC.tasks)) {
    const [id, state] = [row('id'), row('state')]
    const rest = rowLines(status, id)
    const has = (pattern: RegExp): boolean => rest.some((line) => pattern.test(line))
    if (has(/(^|\s)delegate=/) || DELEGATE_MARKER.test(row('task'))) {
      delegated += 1
      if (state === 'x' && !has(/^review=/)) failures.push(`FAIL ${id}: delegated, no review`)
    }
    const rebuilds = rest.filter((line) => /(^|\s)rebuild=/.test(line)).length
    if (rebuilds > 1) failures.push(`FAIL ${id}: ${rebuilds} rebuild lines, the cap is one`)
    const started = state === '~' || state === 'x'
    if (started && PI_MARKER.test(row('task')) && !has(APPROVED)) {
      failures.push(`FAIL ${id}: route=pi row has no approval line`)
    }
  }
  return { failures, delegated }
}
