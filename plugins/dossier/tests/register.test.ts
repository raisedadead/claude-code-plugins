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

  test('a typed /simplify mid-build gets the reminder as context', async ($, on) => {
    on('fs.read', async (_, e) => ({
      value: e.path.endsWith('INDEX.md') ? '| 2026-01-01 | foo | live | P1/1 |\n' : '{"skill":"ds:build","target":"T3"}',
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
})
