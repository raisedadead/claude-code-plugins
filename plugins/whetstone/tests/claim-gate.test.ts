import { describe, expect, test } from 'claude-code/testing'

const UNBACKED = 'Done. The hook blocks the write.'
const BACKED = 'Done. The hook blocks the write and exits 2.'
const KEY = `claims:${new Date().toISOString().slice(0, 10)}`

function memory(on: Parameters<Parameters<typeof test>[1]>[1]): Map<string, unknown> {
  const store = new Map<string, unknown>()
  on('store.get', async (_, e) => ({ value: store.get(e.key) }))
  on('store.set', async (_, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  return store
}

describe('claim count on Stop', () => {
  test('counts an unbacked claim and sends nothing back', async ($, on) => {
    const store = memory(on)
    on('classic.Stop', async () => ({}))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.additionalContext).toBeUndefined()
    expect(result.block).toBeUndefined()
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(store.get(KEY)).toBe(2)
  })

  test('counts nothing for a backed reply, an empty reply or a continued stop', async ($, on) => {
    const store = memory(on)
    on('classic.Stop', async () => ({}))
    await $.classic.Stop({ stop_hook_active: false, last_assistant_message: BACKED })
    await $.classic.Stop({ stop_hook_active: false })
    await $.classic.Stop({ stop_hook_active: true, last_assistant_message: UNBACKED })
    expect(store.get(KEY)).toBeUndefined()
  })

  test('keeps a block and context from beneath', async ($, on) => {
    memory(on)
    on('classic.Stop', async () => ({ block: 'review the diff', additionalContext: ['rig note'] }))
    const result = await $.classic.Stop({ stop_hook_active: false, last_assistant_message: UNBACKED })
    expect(result.block).toBe('review the diff')
    expect(result.additionalContext).toEqual(['rig note'])
  })
})
