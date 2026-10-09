import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import type { DossierWave } from '../types'
import { field } from '../engine/converge.ts'
import { headerToken } from '../engine/ledger.ts'
import { needsTree, ownerLine, progress, progressLine, taskRows } from '../engine/progress.ts'
import { BUILTINS, bugGate, editGate, type Io, ledgerRoot, promptGate, sessionGate, skillGate, skillOf, stopGate, verifyGate } from './gates.ts'

function ioOf($: EngineInterface): Io {
  return {
    isDir: async (path) => {
      try {
        return (await $.fs.stat(path)).kind === 'dir'
      } catch {
        return false
      }
    },
    read: async (path) => String(await $.fs.read(path)),
    exists: (path) => $.fs.exists(path),
    list: async (path) => (await $.fs.list(path)).map((entry) => entry.name),
    env: (name) => {
      if (name === 'DOSSIER_MARKER_GUARD') return $.env.get('DOSSIER_MARKER_GUARD')
      if (name === 'DOSSIER_INVARIANT_GUARD') return $.env.get('DOSSIER_INVARIANT_GUARD')
      return $.env.get('DOSSIER_FAKEIMPL_CMD')
    },
    run: (argv, init) => $.process.run(argv, init),
    cli: `${$.plugin.root}/cli/ds`,
  }
}

const seen = new Set<string>()
const verified = new Set<string>()
const bugsSeen = new Set<string>()
const PANE = 'dossier-tasks'
const wave = atom({ plugin: 'dossier', key: 'wave' } as const, null)
const GLYPH: Record<string, string> = { x: '✓', '~': '▸', '.': '·', '!': '‼', '?': '?' }

async function readOr($: EngineInterface, path: string): Promise<string | undefined> {
  try {
    return String(await $.fs.read(path))
  } catch {
    return undefined
  }
}

async function liveWave($: EngineInterface, cwd: string): Promise<DossierWave | null> {
  const root = await ledgerRoot(ioOf($), cwd)
  const dossiers = `${root}/.scratchpad/dossier`
  let names: string[]
  try {
    names = (await $.fs.list(dossiers)).filter((entry) => entry.kind === 'dir').map((entry) => entry.name)
  } catch {
    return null
  }
  for (const name of names.sort().reverse()) {
    const ledger = await readOr($, `${dossiers}/${name}/DOSSIER.md`)
    if (ledger === undefined || headerToken(ledger) !== 'live') continue
    const contract =
      (await readOr($, `${cwd}/.dossier/${name}.md`)) ??
      (await readOr($, `${root}/.dossier/${name}.md`)) ??
      (await readOr($, `${dossiers}/${name}/CONTRACT.md`))
    const milestone = contract ? field(contract, 'milestone') || undefined : undefined
    return { slug: name.replace(/^\d{4}-\d{2}-\d{2}-/, ''), text: ledger, ...(milestone ? { milestone } : {}) }
  }
  return null
}

async function refresh($: EngineInterface, cwd: string): Promise<void> {
  const next = await liveWave($, cwd)
  await update($, wave, (previous) => (previous?.text === next?.text ? previous : next))
  $.ui.status(next ? progressLine(next.slug, progress(next.text, next.milestone)) : undefined)
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    await $.command.register({ name: PANE, description: 'Show the live dossier tasks and their needs in a pane' })
    await refresh($, e.cwd)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await refresh($, await $.session.cwd())
    return next(e)
  })

  on('command.run', { command: PANE }, async ($) => {
    await refresh($, await $.session.cwd())
    await $.ui.open({ id: PANE, title: 'Dossier tasks' })
    return { text: 'Dossier tasks pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const live = await read($, wave)
    if (!live) return <Text dimColor>No live dossier wave.</Text>
    const view = progress(live.text, live.milestone)
    const width = Math.max(20, e.props.bodyColumns)
    return (
      <Box flexDirection="column">
        <Text bold>{progressLine(live.slug, view)}</Text>
        <Text dimColor>{ownerLine(view)}</Text>
        {needsTree(taskRows(live.text)).map(({ row, depth, also }) => {
          const head = `${'  '.repeat(depth)}${GLYPH[row.state] ?? row.state} ${row.id}${row.who === 'H' ? ' [you]' : ''} `
          const tail = also.length ? ` +${also.join(' +')}` : ''
          const room = Math.max(4, width - head.length - tail.length)
          const task = row.task.length > room ? `${row.task.slice(0, room - 1)}…` : row.task
          return (
            <Text key={row.id} dimColor={row.state === 'x'} bold={row.state === '~'}>
              {`${head}${task}${tail}`}
            </Text>
          )
        })}
      </Box>
    )
  })

  on('classic.PreToolUse', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const context: string[] = []
    if (input.tool === 'Skill') {
      context.push((await skillGate(ioOf($), await ledgerRoot(ioOf($), await $.session.cwd()), skillOf(input), seen)) ?? '')
    } else if (input.tool === 'Edit' || input.tool === 'Write') {
      const root = await ledgerRoot(ioOf($), await $.session.cwd())
      const verdict = await editGate(ioOf($), root, input)
      if (verdict.deny) return { deny: verdict.deny }
      context.push(verdict.context ?? '', (await verifyGate(ioOf($), root, input, verified)) ?? '')
    }
    const result = await next(e)
    const added = context.filter(Boolean)
    if (!added.length) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), ...added] }
  })

  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    if (e.tool_name !== 'Edit' && e.tool_name !== 'Write') return result
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const path = typeof input.file_path === 'string' ? input.file_path : ''
    const context = path ? await bugGate(ioOf($), path, bugsSeen) : undefined
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.UserPromptExpansion', async ($, e, next) => {
    const result = await next(e)
    if (!BUILTINS.has(e.command_name) || !e.cwd) return result
    const context = await skillGate(ioOf($), await ledgerRoot(ioOf($), e.cwd), e.command_name, seen)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    const root = await ledgerRoot(ioOf($), e.cwd)
    const verdict = await sessionGate(ioOf($), root, { source: e.source, session_title: e.session_title ?? '' })
    if (verdict.toast) $.ui.toast(verdict.toast)
    const away = root === e.cwd ? [] : [`dossier ledger: ${root}/.scratchpad — this session works in ${e.cwd}; read and write the ledger by that absolute path.`]
    const context = [...(verdict.context ? [verdict.context] : []), ...(verdict.context ? away : [])]
    return {
      ...result,
      ...(context.length ? { additionalContext: [...(result.additionalContext ?? []), ...context] } : {}),
      ...(verdict.title && !result.sessionTitle ? { sessionTitle: verdict.title } : {}),
    }
  })

  on('classic.UserPromptSubmit', async ($, e, next) => {
    const result = await next(e)
    const context = await promptGate(ioOf($), await ledgerRoot(ioOf($), e.cwd), e.cwd)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    if (result.block) return result
    const block = await stopGate(ioOf($), e.cwd)
    return block ? { ...result, block } : result
  })
}
