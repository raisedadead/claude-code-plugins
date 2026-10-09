import { describe, expect, test } from 'claude-code/testing'

describe('dossier mod wiring', () => {
  test('a marker in a source comment comes back as a denied Edit', async ($, on) => {
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.exists', async () => ({ value: false }))
    on('env.get', async () => ({ value: undefined }))
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    const result = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: '// PH3-B7' } as never)
    expect((result as { text?: string }).text).toContain('dossier marker guard')
  })

  test('a clean Edit runs', async ($, on) => {
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.exists', async () => ({ value: false }))
    on('env.get', async () => ({ value: undefined }))
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    const result = await $.tool.call({ tool: 'Edit', file_path: 'src/a.ts', old_string: 'x', new_string: '// why' } as never)
    expect((result as { result?: string }).result).toBe('ran')
  })

  test('a Write in a dossier project asks the cli to verify it', async ($, on) => {
    const runs: string[][] = []
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.exists', async () => ({ value: false }))
    on('env.get', async () => ({ value: undefined }))
    on('process.run', async (_, e) => {
      runs.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    const result = await $.tool.call({ tool: 'Write', file_path: 'ci.yml', content: 'uses: a@v1' } as never)
    expect((result as { result?: string }).result).toBe('ran')
    expect(runs.map((argv) => argv.slice(-2))).toEqual([['verify-edit', '/w']])
  })

  test('a typed /simplify mid-build gets the reminder as context', async ($, on) => {
    on('fs.read', async (_, e) => ({
      value: e.path.endsWith('INDEX.md')
        ? '| date | slug | state | T | B | mtime | §Z |\n|------|------|-------|---|---|-------|-----|\n| 2026-01-01 | foo | live | 1/2 | 0 | x | — |\n'
        : '{"skill":"ds:build","target":"T3"}',
    }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.list', async () => ({ value: [{ name: '2026-01-01-foo', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] }))
    on('fs.exists', async () => ({ value: true }))
    on('classic.UserPromptExpansion', async () => ({}))
    const result = await $.classic.UserPromptExpansion({
      cwd: '/w',
      expansion_type: 'slash_command',
      command_name: 'simplify',
      command_args: '',
      prompt: '/simplify',
    })
    expect(result.additionalContext?.[0]).toContain('live dossier build in flight (2026-01-01-foo: ds:build T3)')
  })

  test('an edit that adds a bug row with no invariant gets the backprop nudge, and other edits do not', async ($, on) => {
    const ledger = '/w/.scratchpad/dossier/2026-01-01-foo/DOSSIER.md'
    on('fs.read', async (_, e) => ({
      value: e.path === ledger ? '## Bugs\n\n| id | bug | root cause | invariant added | fix cite |\n|---|---|---|---|---|\n| B4 | x | y | — | — |\n' : '',
    }))
    on('classic.PostToolUse', async () => ({}))
    const raise = (file_path: string) => $.classic.PostToolUse({ tool_name: 'Edit', tool_input: { file_path }, tool_response: {}, tool_use_id: 'u1' } as never)
    expect((await raise(ledger)).additionalContext?.[0]).toContain('ds:backprop B4')
    expect((await raise('/w/src/a.ts')).additionalContext).toBeUndefined()
  })

  test('a typed whetstone command gets no expansion reminder', async ($, on) => {
    on('classic.UserPromptExpansion', async () => ({}))
    const result = await $.classic.UserPromptExpansion({
      cwd: '/w',
      expansion_type: 'slash_command',
      command_name: 'whetstone:tdd-cycle',
      command_args: '',
      prompt: '/whetstone:tdd-cycle',
    })
    expect(result.additionalContext).toBeUndefined()
  })

  test('a session start in a dossier project gets the report as context', async ($, on) => {
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('process.run', async () => ({
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ hookSpecificOutput: { additionalContext: '## INDEX' } }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    on('classic.SessionStart', async () => ({}))
    const result = await $.classic.SessionStart({ cwd: '/w', source: 'startup' })
    expect(result.additionalContext).toEqual(['## INDEX'])
  })

  test('a failing fake-impl command blocks the stop', async ($, on) => {
    on('env.get', async (_, e) => ({ value: e.name === 'DOSSIER_FAKEIMPL_CMD' ? 'false' : undefined }))
    on('process.run', async () => ({
      value: {
        exitCode: 0,
        stdout: JSON.stringify({ decision: 'block', reason: 'not verified' }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ cwd: '/w', stop_hook_active: false })
    expect(result.block).toBe('not verified')
  })

  test('the fake-impl backstop stays silent on a continued stop', async ($, on) => {
    let runs = 0
    on('env.get', async (_, e) => ({ value: e.name === 'DOSSIER_FAKEIMPL_CMD' ? 'false' : undefined }))
    on('process.run', async () => {
      runs += 1
      return {
        value: {
          exitCode: 0,
          stdout: JSON.stringify({ decision: 'block', reason: 'not verified' }),
          stderr: '',
          isStdoutTruncated: false,
          isStderrTruncated: false,
        },
      }
    })
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ cwd: '/w', stop_hook_active: true })
    expect(result.block).toBeUndefined()
    expect(runs).toBe(0)
  })
})
