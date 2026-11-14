import { describe, expect, test } from 'claude-code/testing'

const ran = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })

describe('dossier session start', () => {
  test('a start with hanging rows gets the triage as context', async ($, on) => {
    on('process.run', async () => ran('Waits on the operator:\n- O2 Approve the PR (OPEN-WORK.md; waits on the operator)\n'))
    on('classic.SessionStart', async () => ({}))
    const result = await $.classic.SessionStart({ cwd: '/w', source: 'startup' })
    expect(result.additionalContext).toEqual(['ds triage:\nWaits on the operator:\n- O2 Approve the PR (OPEN-WORK.md; waits on the operator)'])
  })

  test('a clear runs triage too', async ($, on) => {
    on('process.run', async () => ran('Live dossiers:\n- demo: build'))
    on('classic.SessionStart', async () => ({}))
    expect((await $.classic.SessionStart({ cwd: '/w', source: 'clear' })).additionalContext).toEqual(['ds triage:\nLive dossiers:\n- demo: build'])
  })

  test('a compaction adds nothing and runs nothing', async ($, on) => {
    let calls = 0
    on('process.run', async () => {
      calls += 1
      return ran('Live dossiers:\n- demo: build')
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
    on('process.run', async () => ran('Live dossiers:\n- demo: plan'))
    on('classic.SessionStart', async () => ({ additionalContext: ['rig'] }))
    expect((await $.classic.SessionStart({ cwd: '/w', source: 'startup' })).additionalContext).toEqual(['rig', 'ds triage:\nLive dossiers:\n- demo: plan'])
  })
})
