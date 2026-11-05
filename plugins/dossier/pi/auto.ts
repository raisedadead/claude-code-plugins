import type { AgentBeforeSettleEvent, BoundaryResult, ExtensionAPI } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { headerToken } from '../engine/ledger.ts'
import { taskRows, progress } from '../engine/progress.ts'
import { ledgerRoot, type Io } from '../hooks/gates.ts'
import { nativeIo } from './io.ts'

type Running = { file: string; initialDone: number; maxTasks: number; rows: string; status: string[]; stalled: number; turns: number }
export type AutoDriver = {
  start: (io: Io, root: string, slug: string, maxTasks?: number) => Promise<void>
  settle: (io: Io, event: Pick<AgentBeforeSettleEvent, 'outcome' | 'continue' | 'entries'>) => Promise<BoundaryResult | undefined>
  reset: () => void
}
const stopLines = (text: string) => text.split('\n').filter((line) => /\bds:build\b.*(?:\bPAUSE\b|auto-stop=)/.test(line))
const signature = (text: string) => JSON.stringify(taskRows(text).map(({ id, state, who, needs, cite }) => ({ id, state, who, needs, cite })))

export function createAutoDriver(): AutoDriver {
  let running: Running | undefined
  let starting = false
  let generation = 0
  const reset = () => {
    generation++
    starting = false
    running = undefined
  }
  function feedback(event: Pick<AgentBeforeSettleEvent, 'entries'>, text: string): BoundaryResult {
    return { entries: [...event.entries, { type: 'custom_message', customType: 'dossier-auto', display: false, content: text }], continue: true }
  }
  return {
    reset,
    async start(io, root, slug, maxTasks = 10) {
      const current = generation
      if (running || starting) throw new Error('Dossier auto is already running; stop it before selecting another wave')
      if (!/^[a-z0-9][a-z0-9-]*$/.test(slug) || !Number.isInteger(maxTasks) || maxTasks < 1 || maxTasks > 100)
        throw new Error('Invalid wave slug or task budget (1–100)')
      starting = true
      try {
        const base = `${root}/.scratchpad/dossier`
        const names = (await io.list(base)).filter((name) => name === slug || name.replace(/^\d{4}-\d{2}-\d{2}-/, '') === slug)
        if (names.length !== 1) throw new Error('Wave is missing or ambiguous; select one exact live wave')
        const file = `${base}/${names[0]}/DOSSIER.md`
        const text = await io.read(file)
        if (current !== generation) throw new Error('Dossier auto start cancelled by session reset')
        if (headerToken(text) !== 'live' || !taskRows(text).length) throw new Error('Auto needs a live dossier with task rows')
        running = { file, initialDone: progress(text).all.done, maxTasks, rows: signature(text), status: stopLines(text), stalled: 0, turns: 0 }
      } finally {
        if (current === generation) starting = false
      }
    },
    async settle(io, event) {
      if (!running) return
      if (event.outcome !== 'completed') {
        reset()
        return
      }
      if (event.continue) return
      const current = running
      let text: string
      try {
        text = await io.read(current.file)
      } catch {
        if (running !== current) return
        reset()
        return feedback(
          event,
          'Dossier auto stopped: the ledger cannot be read. Report the missing path and ask the operator. Send the whole final reply; do not continue work.',
        )
      }
      if (running !== current) return
      if (headerToken(text) !== 'live' || stopLines(text).some((line, index) => current.status[index] !== line)) {
        reset()
        return
      }
      const view = progress(text)
      const active = taskRows(text).some((row) => row.state === '~' && row.who === 'A')
      if (!view.next.length && !active) {
        reset()
        return
      }
      const rows = signature(text)
      current.stalled = rows === current.rows ? current.stalled + 1 : 0
      current.rows = rows
      current.turns++
      const stop =
        view.all.done - current.initialDone >= current.maxTasks
          ? 'task budget reached'
          : current.stalled >= 2
            ? 'no ledger progress after a retry'
            : current.turns >= 30
              ? 'continuation budget reached'
              : undefined
      if (stop) {
        reset()
        return feedback(
          event,
          `Dossier auto stopped: ${stop}. Record a PAUSE or budget handoff through cli/ds, release any owned lock, and send the whole final reply. Do not start another task or restart auto without the operator.`,
        )
      }
      return feedback(
        event,
        'Dossier auto: agent-owned work remains in the actual ledger. Continue the loaded dossier-build --auto protocol for one task, resuming ~ before the frontier. Every operator decision boundary still means PAUSE. Run checks; report the whole reply again. A model DONE claim alone does not complete a ledger row.',
      )
    },
  }
}

export function registerAuto(pi: ExtensionAPI): void {
  const driver = createAutoDriver()
  pi.on('session_start', () => driver.reset())
  pi.on('session_shutdown', () => driver.reset())
  pi.on('session_tree', () => driver.reset())
  pi.on('agent_before_settle', async (event, ctx) => {
    if (ctx.signal?.aborted) {
      driver.reset()
      return
    }
    return driver.settle(nativeIo(ctx.signal), event)
  })
  pi.on('agent_settled', (event) => {
    if (event.aborted) driver.reset()
  })
  pi.registerTool({
    name: 'dossier_auto',
    label: 'Dossier auto',
    description:
      'Opt-in dossier-build --auto driver. Start only for an explicit operator --auto request. Uses the actual task ledger, stops on PAUSE, no progress, budget, session changes or abort. It is not a fresh model evaluator.',
    parameters: Type.Object(
      {
        action: Type.Union([Type.Literal('start'), Type.Literal('stop')]),
        slug: Type.Optional(Type.String()),
        maxTasks: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
      },
      { additionalProperties: false },
    ),
    async execute(_id, input, signal, _update, ctx) {
      signal?.throwIfAborted()
      if (input.action === 'stop') driver.reset()
      else {
        const io = nativeIo(signal)
        const root = await ledgerRoot(io, ctx.cwd)
        await driver.start(io, root, input.slug ?? '', input.maxTasks)
        if (signal?.aborted) {
          driver.reset()
          signal.throwIfAborted()
        }
      }
      return {
        content: [{ type: 'text', text: `Dossier auto ${input.action === 'start' ? 'started' : 'stopped'}.` }],
        details: { active: input.action === 'start' },
      }
    },
  })
  pi.registerCommand('dossier-auto', {
    description: 'Stop the opt-in dossier autonomous driver: /dossier-auto stop',
    handler: async (args, ctx) => {
      if (args.trim() !== 'stop') {
        if (ctx.hasUI) ctx.ui.notify('Usage: /dossier-auto stop. Start through dossier-build --auto.', 'info')
        return
      }
      driver.reset()
      if (ctx.hasUI) ctx.ui.notify('Dossier auto stopped.', 'info')
    },
  })
}
