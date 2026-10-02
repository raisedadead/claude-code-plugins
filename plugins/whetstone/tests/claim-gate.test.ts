import { describe, expect, test } from 'claude-code/testing'

const UNBACKED = 'Done. The hook blocks the write.'
const BACKED = 'Done. The hook blocks the write and exits 2.'

const REASON =
  'Unbacked enforcement claim in the reply:\n' +
  '<stdin>:1: The hook blocks the write.\n' +
  'CLAIMS: FLAGGED 1\n' +
  'A sentence saying something blocks, enforces, gates, denies, prevents ' +
  'or refuses is a claim about runtime. Name the exit code, cite the ' +
  'source, or label it advisory / model-judgment / opt-in — or drop the ' +
  'verb. This gate fires once per turn.'

describe('claim gate on Stop', () => {
  test('blocks a reply with an unbacked claim', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.block).toBe(REASON)
  })

  test('lets a backed reply stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: BACKED })
    expect(result.block).toBeUndefined()
  })

  test('never blocks a continued stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: true, last_assistant_message: UNBACKED })
    expect(result.block).toBeUndefined()
  })

  test('lets a reply with no text stop', async ($, on) => {
    on('classic.Stop', async () => ({}))
    expect((await $.classic.Stop({ stop_hook_active: false })).block).toBeUndefined()
    expect((await $.classic.Stop({ stop_hook_active: false, last_assistant_message: '  \n' })).block).toBeUndefined()
  })

  test('keeps a block from beneath and adds its own reason', async ($, on) => {
    on('classic.Stop', async () => ({ block: 'review the diff' }))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.block).toBe(`review the diff\n\n${REASON}`)
  })

  test('shows ten flagged lines and counts the rest', async ($, on) => {
    on('classic.Stop', async () => ({}))
    const reply = Array.from({ length: 12 }, (_, i) => `The hook blocks write ${i}.`).join('\n')
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: reply })
    const lines = (result.block ?? '').split('\n')
    expect(lines[10]).toBe('<stdin>:10: The hook blocks write 9.')
    expect(lines[11]).toBe('… and 3 more')
  })
})
