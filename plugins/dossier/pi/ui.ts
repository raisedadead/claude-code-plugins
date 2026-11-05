import type { ExtensionContext } from '@earendil-works/pi-coding-agent'
import { contractPaths, DATE_PREFIX, field } from '../engine/converge.ts'
import { headerToken } from '../engine/ledger.ts'
import { needsTree, ownerLine, progress, progressLine, taskRows } from '../engine/progress.ts'
import type { Io } from '../hooks/gates.ts'

const GLYPH: Record<string, string> = { x: '✓', '~': '▸', '.': '·', '!': '‼', '?': '?' }
async function readOr(io: Io, path: string): Promise<string | undefined> {
  try {
    return await io.read(path)
  } catch {
    return undefined
  }
}

export async function taskView(io: Io, root: string, cwd: string): Promise<string[]> {
  const dossiers = `${root}/.scratchpad/dossier`
  let names: string[]
  try {
    names = await io.list(dossiers)
  } catch {
    return ['No live dossier wave.']
  }
  for (const name of names.sort().reverse()) {
    const dir = `${dossiers}/${name}`
    const ledger = await readOr(io, `${dir}/DOSSIER.md`)
    if (ledger === undefined || headerToken(ledger) !== 'live') continue
    let contract: string | undefined
    for (const path of contractPaths([cwd, root], dir)) contract ??= await readOr(io, path)
    const milestone = contract ? field(contract, 'milestone') || undefined : undefined
    const view = progress(ledger, milestone)
    return [
      progressLine(name.replace(DATE_PREFIX, ''), view),
      ownerLine(view),
      ...needsTree(taskRows(ledger)).map(
        ({ row, depth, also }) =>
          `${'  '.repeat(depth)}${GLYPH[row.state] ?? row.state} ${row.id}${row.who === 'H' ? ' [you]' : ''} ${row.task}${also.length ? ` +${also.join(' +')}` : ''}${row.cite && row.cite !== '—' ? ` · ${row.cite}` : ''}`,
      ),
    ]
  }
  return ['No live dossier wave.']
}

export function showStatus(ctx: ExtensionContext, lines: string[]): void {
  if (!ctx.hasUI) return
  const live = lines.length > 1
  ctx.ui.setStatus('dossier', live ? `${lines[0]} · /dossier-tasks` : undefined)
  ctx.ui.setWidget('dossier', live ? lines.slice(0, 2) : undefined)
}
