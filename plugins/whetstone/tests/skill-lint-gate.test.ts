import { describe, expect, test } from 'claude-code/testing'

const FOLDER = '/w/skills'
const skill = (name: string, description: string) => `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n`
const CLEAN = skill('tidy', 'Tidies files. Use when the user says "tidy up".')

function entry(name: string) {
  return { name, kind: 'dir', size: 0, mtimeMs: 0, isLink: false }
}

describe('skill lint reminder on PostToolUse', () => {
  test('a written SKILL.md that fails the lint gets the findings as context, never a block', async ($, on) => {
    on('fs.read', async () => ({ value: skill('tidy', 'Tidies files.') }))
    on('fs.list', async () => ({ value: [entry('tidy')] }))
    on('classic.PostToolUse', async () => ({}))
    const result = await $.classic.PostToolUse({
      tool_name: 'Write',
      tool_input: { file_path: `${FOLDER}/tidy/SKILL.md` },
      tool_response: {},
      tool_use_id: 'u1',
    } as never)
    expect(result.additionalContext?.[0]).toContain("FAIL tidy: description has no 'Use when' / 'Invoke when' trigger clause")
    expect(result.block).toBeUndefined()
  })

  test('a folder that cannot be listed still lints the file and keeps the context from beneath', async ($, on) => {
    on('fs.read', async () => ({ value: skill('tidy', 'Tidies files.') }))
    on('fs.list', async () => {
      throw new Error('EACCES')
    })
    on('classic.PostToolUse', async () => ({ additionalContext: ['bug nag'] }))
    const result = await $.classic.PostToolUse({
      tool_name: 'Write',
      tool_input: { file_path: `${FOLDER}/tidy/SKILL.md` },
      tool_response: {},
      tool_use_id: 'u4',
    } as never)
    expect(result.additionalContext?.[0]).toBe('bug nag')
    expect(result.additionalContext?.[1]).toContain('FAIL tidy:')
  })

  test('a sibling that shares a trigger phrase adds a warning for the written skill', async ($, on) => {
    const files: Record<string, string> = {
      [`${FOLDER}/tidy/SKILL.md`]: CLEAN,
      [`${FOLDER}/sweep/SKILL.md`]: skill('sweep', 'Sweeps files. Use when the user says "tidy up".'),
    }
    on('fs.read', async (_, e) => {
      const text = files[e.path]
      if (text === undefined) throw new Error(`ENOENT ${e.path}`)
      return { value: text }
    })
    on('fs.list', async () => ({ value: [entry('tidy'), entry('sweep'), entry('README.md')] }))
    on('classic.PostToolUse', async () => ({}))
    const result = await $.classic.PostToolUse({
      tool_name: 'Edit',
      tool_input: { file_path: `${FOLDER}/tidy/SKILL.md` },
      tool_response: {},
      tool_use_id: 'u2',
    } as never)
    expect(result.additionalContext?.[0]).toContain('WARN tidy: trigger phrase "tidy up" is also in sweep')
    expect(result.additionalContext?.[0]).not.toContain('WARN sweep:')
  })

  test('a clean SKILL.md and a file that is not a SKILL.md get no context', async ($, on) => {
    const reads: string[] = []
    on('fs.read', async (_, e) => {
      reads.push(e.path)
      return { value: CLEAN }
    })
    on('fs.list', async () => ({ value: [entry('tidy')] }))
    on('classic.PostToolUse', async () => ({}))
    const write = (file_path: string) => $.classic.PostToolUse({ tool_name: 'Write', tool_input: { file_path }, tool_response: {}, tool_use_id: 'u3' } as never)
    expect((await write(`${FOLDER}/tidy/SKILL.md`)).additionalContext).toBeUndefined()
    expect((await write('/w/src/SKILL.md.bak')).additionalContext).toBeUndefined()
    expect((await write('/w/notes/SKILL.md')).additionalContext).toBeUndefined()
    expect(reads).toEqual([`${FOLDER}/tidy/SKILL.md`])
  })

  test('a Read of a failing SKILL.md, and a written file that cannot be read, get no context', async ($, on) => {
    let readable = true
    on('fs.read', async () => {
      if (!readable) throw new Error('ENOENT')
      return { value: skill('tidy', 'Tidies files.') }
    })
    on('fs.list', async () => ({ value: [entry('tidy')] }))
    on('classic.PostToolUse', async () => ({}))
    const call = (tool_name: string) =>
      $.classic.PostToolUse({ tool_name, tool_input: { file_path: `${FOLDER}/tidy/SKILL.md` }, tool_response: {}, tool_use_id: 'u5' } as never)
    expect((await call('Read')).additionalContext).toBeUndefined()
    readable = false
    expect((await call('Write')).additionalContext).toBeUndefined()
  })
})
