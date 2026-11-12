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

function alone(root: string, path: string, command: string): void {
  writeFileSync(path, contract(command))
  git(root, 'commit', '-q', '-m', 'contract only', '--', path)
}

test('a mixed table edit reverted, then redone in a contract-only commit, closes', async () => {
  await within(async ({ root, path, close }) => {
    mixed(root, path, 'true')
    git(root, 'revert', '--no-edit', 'HEAD')
    alone(root, path, 'test -e done.txt')
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

test('a contract-only commit on top of an unseen mixed edit does not settle it', async () => {
  await within(async ({ root, path, close }) => {
    mixed(root, path, 'true')
    alone(root, path, 'test -e done.txt')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('a mixed table edit after a contract-only commit still refuses', async () => {
  await within(async ({ root, path, close }) => {
    alone(root, path, 'test -e done.txt')
    mixed(root, path, 'true')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})

test('a table changed only in a merge refuses until it is back to a table seen alone', async () => {
  await within(async ({ root, path, close }) => {
    git(root, 'switch', '-q', '-c', 'side')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'side moves')
    git(root, 'switch', '-q', 'main')
    git(root, 'commit', '-q', '--allow-empty', '-m', 'main moves')
    git(root, 'merge', '-q', '--no-commit', '-s', 'ours', 'side')
    writeFileSync(path, contract('true'))
    git(root, 'add', path)
    git(root, 'commit', '-q', '--no-edit')
    const refused = await close()
    assert.equal(refused.status, 1, refused.stdout)
    assert.equal(lines(refused, '✗').filter((line) => line.includes('never seen alone')).length, 1, refused.stdout)
    alone(root, path, 'test -f done.txt')
    alone(root, path, 'true')
    const settled = await close()
    assert.equal(settled.status, 0, settled.stdout)
  })
})

test('a mixed edit kept by a merge is not settled by a side-branch contract-only edit', async () => {
  await within(async ({ root, path, close }) => {
    const row2 = (text: string): string => text.replace('| exit 0 |', '| exit 0 |\n| 2 | `true` | exit 0 |')
    git(root, 'branch', 'side')
    mixed(root, path, 'true')
    git(root, 'switch', '-q', 'side')
    writeFileSync(path, row2(contract('test -f done.txt')))
    git(root, 'commit', '-q', '-m', 'contract only', '--', path)
    git(root, 'switch', '-q', 'main')
    git(root, 'merge', '-q', '--no-commit', '-s', 'ours', 'side')
    writeFileSync(path, row2(contract('true')))
    git(root, 'add', path)
    git(root, 'commit', '-q', '--no-edit')
    const result = await close()
    assert.equal(result.status, 1, result.stdout)
    assert.equal(lines(result, '✗').length, 1, result.stdout)
  })
})
