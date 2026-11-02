import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0).reverse()) clean()
})

function root(): string {
  const { dir, clean } = tempRoot('dossier-move-')
  cleanups.push(clean)
  return dir
}

function makeSrc(dir: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'DOSSIER.md'), 'closed dossier fixture\n')
}

test('a happy move lands at the destination and removes the source, and a repeat is an idempotent no-op', async () => {
  const base = root()
  const dossier = join(base, 'dossier')
  const archive = join(dossier, '_archive')
  makeSrc(join(dossier, '2026-06-01-happy'))
  const moved = await ds(base, ['archive-move', join(dossier, '2026-06-01-happy'), archive])
  assert.equal(moved.code, 0, 'happy move must exit 0')
  assert.ok(existsSync(join(archive, '2026-06-01-happy', 'DOSSIER.md')), 'moved dossier missing at dest')
  assert.ok(!existsSync(join(dossier, '2026-06-01-happy')), 'src must be gone after move')
  const again = await ds(base, ['archive-move', join(dossier, '2026-06-01-happy'), archive])
  assert.equal(again.code, 0, 'resume of already-moved must be idempotent no-op exit 0')
})

test('a pre-existing destination is refused, the source survives and the destination is not clobbered', async () => {
  const base = root()
  const dossier = join(base, 'dossier')
  const archive = join(dossier, '_archive')
  makeSrc(join(dossier, '2026-06-01-clash'))
  mkdirSync(join(archive, '2026-06-01-clash'), { recursive: true })
  writeFileSync(join(archive, '2026-06-01-clash', 'DOSSIER.md'), 'pre-existing\n')
  const refused = await ds(base, ['archive-move', join(dossier, '2026-06-01-clash'), archive])
  assert.notEqual(refused.code, 0, 'pre-existing dest must be refused')
  assert.ok(existsSync(join(dossier, '2026-06-01-clash', 'DOSSIER.md')), 'src must survive a refused move')
  assert.ok(readFileSync(join(archive, '2026-06-01-clash', 'DOSSIER.md'), 'utf8').includes('pre-existing'), 'refused move must not clobber dest')
})

test('a missing source is an error', async () => {
  const base = root()
  const dossier = join(base, 'dossier')
  makeSrc(join(dossier, '2026-06-01-nodest'))
  const missing = await ds(base, ['archive-move', join(dossier, '2026-06-01-missing'), join(dossier, '_archive')])
  assert.notEqual(missing.code, 0, 'missing src must error')
})

test('an unwritable archive parent fails and the source survives', async () => {
  const base = root()
  const dossier = join(base, 'dossier')
  makeSrc(join(dossier, '2026-06-01-ro'))
  const readonly = join(base, 'readonly-archive')
  mkdirSync(readonly)
  chmodSync(readonly, 0o500)
  cleanups.push(() => chmodSync(readonly, 0o700))
  const failed = await ds(base, ['archive-move', join(dossier, '2026-06-01-ro'), join(readonly, 'arc')])
  assert.notEqual(failed.code, 0, 'unwritable archive parent must fail')
  assert.ok(existsSync(join(dossier, '2026-06-01-ro', 'DOSSIER.md')), 'src must survive a failed move (rollback)')
})
