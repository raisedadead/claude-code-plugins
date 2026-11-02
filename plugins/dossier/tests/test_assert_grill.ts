import assert from 'node:assert/strict'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, test } from 'vitest'
import { ds, tempRoot } from './inproc.ts'

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean()
})

function root(): string {
  const { dir, clean } = tempRoot('dossier-assertgrill-')
  cleanups.push(clean)
  return dir
}

test('assert-grill resolves, gates and consumes the newest artifact for a slug', async () => {
  const tmp = root()
  const grillDir = join(tmp, 'dossier', '.grill')
  mkdirSync(grillDir, { recursive: true })

  const missing = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(missing.code, 1, `missing artifact must exit 1 (got ${missing.code})`)

  const older = join(grillDir, '2026-07-18-alpha.md')
  writeFileSync(older, ['FACT: repo uses bash tests cite=ci.yml', 'DECISION: scope recommended=narrow answer=narrow', ''].join('\n'))
  const bare = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(bare.code, 2, `artifact without footers must exit 2 (got ${bare.code})`)

  appendFileSync(older, 'FRONTIER: empty-except-external\n')
  const noCount = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(noCount.code, 2, `empty-except-external without n= must exit 2 (got ${noCount.code})`)

  appendFileSync(older, 'FRONTIER: empty\nCONFIRMED: 2026-07-20T19:00:00Z operator="ship it"\n')
  const complete = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(complete.code, 0, 'complete artifact found across dates must exit 0')
  assert.equal(complete.stdout, `${older}\n`, 'must print resolved artifact path')

  writeFileSync(
    join(grillDir, '2026-07-19-beta.md'),
    [
      'DECISION: budget recommended=ask-cfo answer=pending-external',
      'FRONTIER: empty-except-external n=1',
      'CONFIRMED: 2026-07-20T19:05:00Z operator="proceed without cfo"',
      '',
    ].join('\n'),
  )
  const beta = await ds(tmp, ['assert-grill', tmp, 'beta'])
  assert.equal(beta.code, 0, 'empty-except-external n=1 + CONFIRMED must exit 0')

  const newest = join(grillDir, '2026-07-20-alpha.md')
  writeFileSync(newest, ['FRONTIER: empty', 'CONFIRMED: 2026-07-20T20:00:00Z operator="go"', ''].join('\n'))
  const twice = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(twice.code, 0, 'two artifacts same slug must still exit 0')
  assert.equal(twice.stdout, `${newest}\n`, 'must resolve newest artifact by date')

  const consume = await ds(tmp, ['assert-grill', '--consume', tmp, 'alpha', '2026-07-20-alpha'])
  assert.equal(consume.code, 0, 'consume on complete artifact must exit 0')
  assert.ok(readFileSync(newest, 'utf8').split('\n').includes('CONSUMED: 2026-07-20-alpha'), 'consume must stamp the dossier dir key')

  const again = await ds(tmp, ['assert-grill', '--consume', tmp, 'alpha', '2026-07-20-alpha-again'])
  assert.equal(again.code, 4, `double consume must exit 4 (got ${again.code})`)

  const consumed = await ds(tmp, ['assert-grill', tmp, 'alpha'])
  assert.equal(consumed.code, 4, `consumed newest must exit 4, never fall back to older (got ${consumed.code})`)

  const bumped = await ds(tmp, ['assert-grill', tmp, 'alpha-2'])
  assert.equal(bumped.code, 1, `bumped slug must not inherit base-slug artifact (got ${bumped.code})`)
})
