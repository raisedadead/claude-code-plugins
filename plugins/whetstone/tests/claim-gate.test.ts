import { describe, expect, test } from 'claude-code/testing'

const UNBACKED = 'Done. The hook blocks the write.'
const BACKED = 'Done. The hook blocks the write and exits 2.'

const REASON =
  'Unbacked claim in the reply:\n' +
  'line 1: "The hook blocks the write."\n' +
  'Name the exit code, cite the source, or label it advisory / model-judgment / opt-in — or drop the blocks / enforces / gates / denies / prevents / refuses verb.\n' +
  'Then send the whole reply again with the fix. In focus mode the operator sees only your last message.'

describe('claim gate on Stop', () => {
  test('sends an unbacked claim back as context and does not block', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.additionalContext).toEqual([REASON])
    expect(result.block).toBeUndefined()
  })

  test('lets a backed reply stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: BACKED })
    expect(result.additionalContext).toBeUndefined()
  })

  test('stays silent on a continued stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: UNBACKED })
    expect(result.additionalContext).toBeUndefined()
  })

  test('lets a reply with no text stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    expect((await $.classic.Stop({ stop_hook_active: false })).additionalContext).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '  \n' })).additionalContext).toBeUndefined()
  })

  test('keeps a block and context from beneath and adds its own reason', async ($, on) => {
    on('classic.Stop', async () => ({ block: 'review the diff', additionalContext: ['rig note'] }))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.block).toBe('review the diff')
    expect(result.additionalContext).toEqual(['rig note', REASON])
  })

  test('shows ten flagged lines and counts the rest', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const reply = Array.from({ length: 12 }, (_, i) => `The hook blocks write ${i}.`).join('\n')
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: reply })
    const lines = (result.additionalContext?.[0] ?? '').split('\n')
    expect(lines[10]).toBe('line 10: "The hook blocks write 9."')
    expect(lines[11]).toBe('… and 2 more')
  })
})
