import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, test } from 'vitest'
import { contract, git, lines, repo, within } from './close_edit_kit.ts'

afterAll(() => repo.clean())

function mixed(root: string, path: string, command: string): void {
  writeFileSync(path, contract(command))
  writeFileSync(join(root, 'other.txt'), command)
  git(root, 'add', path, 'other.txt')
  git(root, 'commit', '-q', '-m', 'mixed')
}

test('a mixed table edit redone in a contract-only commit closes', async () => {
  await within(async ({ root, path, close }) => {
    mixed(root, path, 'true')
    writeFileSync(path, contract('test -e done.txt'))
    git(root, 'commit', '-q', '-am', 'contract only')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
    assert.equal(lines(result, '·').filter((line) => line.includes('contract-only')).length, 1, result.stdout)
  })
})

test('a mixed table edit reverted to the committed table closes', async () => {
  await within(async ({ root, path, close }) => {
    mixed(root, path, 'true')
    git(root, 'revert', '--no-edit', 'HEAD')
    const result = await close()
    assert.equal(result.status, 0, result.stdout)
    assert.deepEqual(lines(result, '✗'), [])
  })
})

test('a mixed table edit after a contract-only commit still refuses', async () => {
  await within(async ({ root, path, close }) => {
    writeFileSync(path, contract('test -e done.txt'))
    git(root, 'commit', '-q', '-am', 'contract only')
    mixed(root, path, 'true')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})
