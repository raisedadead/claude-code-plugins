import { describe, expect, test } from 'claude-code/testing'

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

describe('dossier session start', () => {
  test('a start with hanging rows gets the triage as context', async ($, on) => {
    let argv: unknown
    on('process.run', async (...call: unknown[]) => {
      argv = (call[1] as { argv: string[] }).argv
      return ran('Deferred and now due:\n- O2 Approve the PR (OPEN-WORK.md; date 2026-11-01 passed)\n')
    })
    on('classic.SessionStart', async () => ({}))
    const result = await $.classic.SessionStart({ cwd: '/w', source: 'startup' })
    expect((argv as string[]).slice(-2)).toEqual(['triage', '--start'])
    expect(result.additionalContext).toEqual(['ds triage:\nDeferred and now due:\n- O2 Approve the PR (OPEN-WORK.md; date 2026-11-01 passed)'])
  })

  test('a clear runs triage too', async ($, on) => {
    on('process.run', async () => ran('Plan changed since its check:\n- demo'))
    on('classic.SessionStart', async () => ({}))
    expect((await $.classic.SessionStart({ cwd: '/w', source: 'clear' })).additionalContext).toEqual(['ds triage:\nPlan changed since its check:\n- demo'])
  })

  test('a compaction adds nothing and runs nothing', async ($, on) => {
    let calls = 0
    on('process.run', async () => {
      calls += 1
      return ran('Plan changed since its check:\n- demo')
    })
    on('classic.SessionStart', async () => ({}))
    expect((await $.classic.SessionStart({ cwd: '/w', source: 'compact' })).additionalContext).toBeUndefined()
    expect(calls).toBe(0)
  })

  test('a quiet triage, a failed run or a non-repo adds nothing', async ($, on) => {
    const outputs = [ran('Nothing is hanging and no dossier is live.\n'), ran('', 1)]
    on('process.run', async () => outputs.shift() ?? ran(''))
    on('classic.SessionStart', async () => ({}))
    for (let i = 0; i < 3; i += 1) expect((await $.classic.SessionStart({ cwd: '/w', source: 'startup' })).additionalContext).toBeUndefined()
  })

  test('context from beneath is kept', async ($, on) => {
    on('process.run', async () => ran('Out of shape:\n- line 4 - bad row'))
    on('classic.SessionStart', async () => ({ additionalContext: ['rig'] }))
    expect((await $.classic.SessionStart({ cwd: '/w', source: 'startup' })).additionalContext).toEqual(['rig', 'ds triage:\nOut of shape:\n- line 4 - bad row'])
  })
})

type On = Parameters<Parameters<typeof test>[1]>[1]
type Seen = { lines: (string | undefined)[]; calls: { argv: readonly string[]; init?: { cwd?: string } }[] }

const TURN = { answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' } as const
const ONE = 'demo · plan · 1/3 · next O2 · [H] 1'

function session(
  on: On,
  run: () => ReturnType<typeof ran>,
  surfaces: () => readonly 'terminal'[] = () => ['terminal'],
  cwd: () => string = () => '/s',
  sid: () => string = () => 's1',
): Seen {
  const seen: Seen = { lines: [], calls: [] }
  on('session.surfaces', async () => ({ value: surfaces() }))
  on('session.id', async () => ({ value: sid() }))
  on('session.cwd', async () => ({ value: cwd() }))
  on('process.run', async (_, e) => {
    seen.calls.push(e)
    return run()
  })
  on('ui.status', async (_, e) => {
    seen.lines.push(e.text)
    return { value: undefined }
  })
  on('session.start', async (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', async () => ({ text: 'the answer' }))
  return seen
}

describe('dossier status line', () => {
  test('a session start pins the line that ds status prints for this session in the start folder', async ($, on) => {
    const seen = session(on, () => ran(`${ONE}\n`))
    expect(await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })).toEqual({ cwd: '/w' })
    expect(seen.lines).toEqual([ONE])
    expect(seen.calls.map((call) => [call.argv.slice(-3), call.init?.cwd])).toEqual([[['status', '--session', 's1'], '/w']])
  })

  test('the end of a main-loop turn pins the line for this session in its folder, and the turn result stays as it is', async ($, on) => {
    const seen = session(on, () => ran(`${ONE}\n`))
    expect(await $.turn.complete(TURN)).toEqual({ text: 'the answer' })
    expect(seen.lines).toEqual([ONE])
    expect(seen.calls.map((call) => [call.argv.slice(-3), call.init?.cwd])).toEqual([[['status', '--session', 's1'], '/s']])
  })

  test('a clear pins the line of the new session at once', async ($, on) => {
    const seen = session(
      on,
      () => ran(''),
      () => ['terminal'],
      () => '/s',
      () => 's2',
    )
    on('classic.SessionStart', async () => ({}))
    await $.classic.SessionStart({ cwd: '/w', source: 'clear' })
    expect(seen.lines).toEqual([undefined])
    expect(seen.calls.map((call) => call.argv.slice(2))).toEqual([
      ['status', '--session', 's2'],
      ['triage', '--start'],
    ])
  })

  test('with no session id the mod runs nothing and clears the line', async ($, on) => {
    const seen = session(
      on,
      () => ran(`${ONE}\n`),
      () => ['terminal'],
      () => '/s',
      () => '',
    )
    expect(await $.turn.complete(TURN)).toEqual({ text: 'the answer' })
    expect(seen).toEqual({ lines: [undefined], calls: [] })
  })

  test('two lines of output are pinned as one line', async ($, on) => {
    const seen = session(on, () => ran('demo · plan · no rows\nother · build · 2/2\n'))
    await $.turn.complete(TURN)
    expect(seen.lines).toEqual(['demo · plan · no rows │ other · build · 2/2'])
  })

  test('no live dossier, a failed run and a run that throws each clear the line and leave the turn result', async ($, on) => {
    const runs = [
      () => ran('\n'),
      () => ran('', 1),
      () => {
        throw new Error('timeout')
      },
    ]
    const seen = session(on, () => (runs.shift() ?? (() => ran('\n')))())
    for (let i = 0; i < 3; i += 1) expect(await $.turn.complete(TURN)).toEqual({ text: 'the answer' })
    expect(seen.lines).toEqual([undefined, undefined, undefined])
  })

  test('a surfaces call that throws leaves the session start and the turn as they are', async ($, on) => {
    const seen = session(
      on,
      () => ran(`${ONE}\n`),
      () => {
        throw new Error('no surfaces')
      },
    )
    expect(await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/w' })).toEqual({ cwd: '/w' })
    expect(await $.turn.complete(TURN)).toEqual({ text: 'the answer' })
    expect(seen.calls).toEqual([])
  })

  test('a cwd call that throws leaves the turn as it is', async ($, on) => {
    const seen = session(
      on,
      () => ran(`${ONE}\n`),
      () => ['terminal'],
      () => {
        throw new Error('no cwd')
      },
    )
    expect(await $.turn.complete(TURN)).toEqual({ text: 'the answer' })
    expect(seen.calls).toEqual([])
  })

  test('the end of a helper turn runs nothing and pins nothing', async ($, on) => {
    const seen = session(on, () => ran(`${ONE}\n`))
    expect(await $.turn.complete({ ...TURN, agentId: 'a1' })).toEqual({ text: 'the answer' })
    expect(seen).toEqual({ lines: [], calls: [] })
  })

  test('a session that draws nowhere runs nothing and pins nothing', async ($, on) => {
    const seen = session(
      on,
      () => ran(`${ONE}\n`),
      () => [],
    )
    await $.session.start({ surface: null, isInteractive: false, cwd: '/w' })
    await $.turn.complete(TURN)
    expect(seen).toEqual({ lines: [], calls: [] })
  })
})
