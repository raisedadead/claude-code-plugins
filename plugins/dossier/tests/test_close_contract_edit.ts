import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { contract, git, lines, repo, within } from './close_edit_kit.ts'

afterAll(() => repo.clean())

test('a criterion edited in a commit beside other files refuses the close', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('true'))
    writeFileSync(join(root, 'other.txt'), 'x')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('a criterion edited in a contract-only commit closes and the edit is named', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    git(root, 'commit', '-q', '-am', 'edit criterion')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
    assert.equal(lines(result, '·').filter((line) => line.includes('contract-only')).length, 1, result.stdout)
  })
})

test('an uncommitted criterion edit refuses the close', async () => {
  await within(async ({ path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('an edit outside the done-when table in a mixed commit does not refuse', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('test -f done.txt', '9 commits'))
    writeFileSync(join(root, 'other.txt'), 'x')
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'mixed')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
  })
})
