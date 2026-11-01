import { describe, expect, test } from 'claude-code/testing'

const blocking = {
  exitCode: 0,
  stdout: JSON.stringify({ decision: 'block', reason: 'not verified' }),
  stderr: '',
  isStdoutTruncated: false,
  isStderrTruncated: false,
}

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

  test('a non-canonical ledger header comes back as a denied Write, and a canonical one runs', async ($, on) => {
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('env.get', async () => ({ value: undefined }))
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    const write = (state: string) =>
      $.tool.call({
        tool: 'Write',
        file_path: '/w/.scratchpad/dossier/2026-01-01-foo/DOSSIER.md',
        content: `# foo\n\n\`2026-01-01\` · \`${state}\`\n`,
      } as never)
    expect((await write('bogus')) as { text?: string }).toMatchObject({ text: expect.stringContaining("non-canonical header state 'bogus'") })
    expect(((await write('live')) as { result?: string }).result).toBe('ran')
  })

  test('an edit that matches a registered invariant comes back denied, and a passing check lets it run', async ($, on) => {
    let verdict = { exitCode: 1, stdout: 'dossier invariant guard: no-raw-sql' }
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.exists', async (_, e) => ({ value: e.path.endsWith('.invariant-guards.json') }))
    on('env.get', async () => ({ value: undefined }))
    on('process.run', async (_, e) => ({
      value: {
        ...(e.argv.includes('invariant-check') ? verdict : { exitCode: 0, stdout: '' }),
        stderr: '',
        isStdoutTruncated: false,
        isStderrTruncated: false,
      },
    }))
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    const edit = () => $.tool.call({ tool: 'Edit', file_path: 'src/a.py', old_string: 'x', new_string: 'execute("SELECT 1")' } as never)
    expect(((await edit()) as { text?: string }).text).toContain('dossier invariant guard: no-raw-sql')
    verdict = { exitCode: 0, stdout: '' }
    expect(((await edit()) as { result?: string }).result).toBe('ran')
  })

  test('a gated Skill call reads the live index for its reminder, and an ungated one does not', async ($, on) => {
    const reads: string[] = []
    on('session.cwd', async () => ({ value: '/w' }))
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('fs.read', async (_, e) => {
      reads.push(e.path)
      return {
        value: '| date | slug | state | T | B | mtime | §Z |\n|------|------|-------|---|---|-------|-----|\n| 2026-01-01 | foo | live | 1/2 | 0 | x | — |\n',
      }
    })
    on('classic.PreToolUse', async () => ({}))
    on('tool.call', async () => ({ result: 'ran' }))
    await $.tool.call({ tool: 'Skill', skill: 'dossier:status' } as never)
    expect(reads).toEqual([])
    await $.tool.call({ tool: 'Skill', skill: 'whetstone:doubt-pass' } as never)
    expect(reads).toEqual(['/w/.scratchpad/INDEX.md'])
  })

  test('a prompt in a dossier project gets the wave contract as context, and one outside does not', async ($, on) => {
    let inside = true
    on('fs.stat', async () => ({ value: { kind: inside ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } }))
    on('process.run', async () => ({
      value: { exitCode: 0, stdout: 'wave foo contract · 3 criteria\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }))
    on('classic.UserPromptSubmit', async () => ({}))
    const submit = () => $.classic.UserPromptSubmit({ cwd: '/w', session_id: 's4', transcript_path: '', prompt: 'next' } as never)
    expect((await submit()).additionalContext).toEqual(['wave foo contract · 3 criteria'])
    inside = false
    expect((await submit()).additionalContext).toBeUndefined()
  })

  test('a doubter stop goes to the verdict log, and another agent or a blocked stop does not', async ($, on) => {
    const runs: string[][] = []
    let block: string | undefined
    on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
    on('process.run', async (_, e) => {
      runs.push([...e.argv])
      return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    })
    on('classic.SubagentStop', async () => (block ? { block } : {}))
    const stop = (agent_type: string) =>
      $.classic.SubagentStop({ cwd: '/w', session_id: 's5', agent_id: 'a1', agent_type, last_assistant_message: 'DOUBT: FAILURES' } as never)
    await stop('general-purpose')
    expect(runs).toEqual([])
    block = 'keep going'
    await stop('whetstone:whetstone-doubter')
    expect(runs).toEqual([])
    block = undefined
    await stop('whetstone:whetstone-doubter')
    expect(runs.map((argv) => argv.slice(-2))).toEqual([['verdict-log', '/w']])
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
    const result = await $.classic.Stop({ cwd: '/w', session_id: 's0', stop_hook_active: false })
    expect(result.block).toBe('not verified\nThen send the whole reply again. In focus mode the operator sees only your last message.')
  })

  test('the fake-impl backstop blocks once per stop chain', async ($, on) => {
    on('env.get', async (_, e) => ({ value: e.name === 'DOSSIER_FAKEIMPL_CMD' ? 'false' : undefined }))
    on('process.run', async () => ({ value: blocking }))
    on('classic.Stop', async () => ({}))
    expect((await $.classic.Stop({ cwd: '/w', session_id: 's1', stop_hook_active: false })).block).toContain('not verified')
    expect((await $.classic.Stop({ cwd: '/w', session_id: 's1', stop_hook_active: true })).block).toBeUndefined()
    expect((await $.classic.Stop({ cwd: '/w', session_id: 's1', stop_hook_active: false })).block).toContain('not verified')
  })

  test('the fake-impl backstop joins a block from another hook', async ($, on) => {
    on('env.get', async (_, e) => ({ value: e.name === 'DOSSIER_FAKEIMPL_CMD' ? 'false' : undefined }))
    on('process.run', async () => ({ value: blocking }))
    on('classic.Stop', async () => ({ block: 'review first' }))
    const result = await $.classic.Stop({ cwd: '/w', session_id: 's2', stop_hook_active: false })
    expect(result.block).toContain('review first')
    expect(result.block).toContain('not verified')
  })

  test('the fake-impl backstop runs on a stop that another hook continued', async ($, on) => {
    on('env.get', async (_, e) => ({ value: e.name === 'DOSSIER_FAKEIMPL_CMD' ? 'false' : undefined }))
    on('process.run', async () => ({ value: blocking }))
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ cwd: '/w', session_id: 's3', stop_hook_active: true })
    expect(result.block).toContain('not verified')
  })
})
