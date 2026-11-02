import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

let tmp = ''
let clean = (): void => {}
beforeEach(() => {
  ;({ dir: tmp, clean } = tempRoot('ds-check-'))
})
afterEach(() => clean())

function mk(rel: string, token: string, zbody = '_(empty)_'): void {
  const dir = join(tmp, '.scratchpad', 'dossier', rel)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), ['`2026-06-01` · `' + token + '` · `P1/1`', '', '## §Z — Closeout', '', zbody, ''].join('\n'))
}

test('a clean tree exits 0; a closed wave left live is drift, named on stderr', async () => {
  mk('2026-06-02-good', 'live')
  const clean = await ds(tmp, ['ds-check', join(tmp, '.scratchpad')])
  assert.equal(clean.code, 0, clean.stderr)
  mk('2026-06-03-zombie', 'done', 'complete: true')
  const drift = await ds(tmp, ['ds-check', join(tmp, '.scratchpad')])
  assert.notEqual(drift.code, 0)
  assert.match(drift.stderr, /zombie/)
  assert.match(drift.stderr, /drift/i)
})
