import { describe, expect, test } from 'claude-code/testing'

const LEDGER = [
  '# wave',
  '',
  '`2026-10-08` · `live`',
  '',
  '## Tasks',
  '',
  '| id | state | who | task | needs | cite | verify |',
  '|----|-------|-----|------|-------|------|--------|',
  '| T1 | x | A | build the verb | — | abc1234 | v |',
  '| T2 | ~ | A | wire the hook | T1 | — | v |',
  '| T3 | . | H | approve the rollout | T2 | — | v |',
  '',
].join('\n')

const PROPS = { title: 'Dossier tasks', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} } as const

function ledgerAt(on: Parameters<Parameters<typeof test>[1]>[1], text: string | undefined, statuses: (string | undefined)[]): void {
  on('session.cwd', async () => ({ value: '/w' }))
  on('fs.stat', async () => ({ value: { kind: 'dir', size: 0, mtimeMs: 0, isLink: false } }))
  on('fs.list', async () => ({ value: text ? [{ name: '2026-10-08-wave', kind: 'dir', size: 0, mtimeMs: 0, isLink: false }] : [] }))
  on('fs.read', async (_, e) => {
    if (text && e.path.endsWith('/DOSSIER.md')) return { value: text }
    throw new Error('ENOENT')
  })
  on('command.register', async () => ({ value: undefined }))
  on('ui.status', async (_, e) => {
    statuses.push(e.text)
    return { value: undefined }
  })
}

describe('dossier tasks pane', () => {
  test('the status line and the pane lead with the progress line and draw the needs tree', async ($, on) => {
    const statuses: (string | undefined)[] = []
    ledgerAt(on, LEDGER, statuses)
    on('turn.complete', async () => ({ text: '' }))
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(statuses).toEqual(['wave 33% · 1/3 · in progress T2'])
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'dossier', surface, component: 'Pane', requestId: 'dossier-tasks', props: PROPS as never })
      const lines = (await ui.findAll({ type: 'Text' })).map((element) => element.text)
      expect(lines).toEqual([
        'wave 33% · 1/3 · in progress T2',
        'Agent 1/2 · You 0/1 · in progress T2',
        '✓ T1 build the verb',
        '  ▸ T2 wire the hook',
        '    · T3 [you] approve the rollout',
      ])
      await ui.unmount()
    }
  })

  test('with no live wave the status line clears and the pane says so', async ($, on) => {
    const statuses: (string | undefined)[] = []
    ledgerAt(on, undefined, statuses)
    on('turn.complete', async () => ({ text: '' }))
    await $.turn.complete({ answer: '', durationMs: 0, isAborted: false, turnId: 't1', reason: 'answer' })
    expect(statuses.at(-1)).toBeUndefined()
    const ui = await $.ui.mount({ plugin: 'dossier', surface: 'terminal', component: 'Pane', requestId: 'dossier-tasks', props: PROPS as never })
    expect(await ui.find({ type: 'Text', text: /No live dossier wave/ })).toBeDefined()
    await ui.unmount()
  })
})
