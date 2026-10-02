import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { WHETSTONE } from '../hooks/gates.ts'

test('the skill gate names every shipped whetstone skill and nothing else', () => {
  const skills = join(import.meta.dirname, '..', '..', 'whetstone', 'skills')
  const shipped = readdirSync(skills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `whetstone:${entry.name}`)
    .sort()
  assert.deepEqual([...WHETSTONE].sort(), shipped)
})
