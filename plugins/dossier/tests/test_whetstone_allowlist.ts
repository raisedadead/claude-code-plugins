import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { WHETSTONE } from '../hooks/gates.ts'

test('the skill gate names every whetstone skill that asks for a ledger line, and nothing else', () => {
  const skills = join(import.meta.dirname, '..', '..', 'whetstone', 'skills')
  const shipped = readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => /§S|s-append/.test(readFileSync(join(skills, entry.name, 'SKILL.md'), 'utf8')))
    .map((entry) => `whetstone:${entry.name}`)
    .sort()
  assert.deepEqual([...WHETSTONE].sort(), shipped)
})
