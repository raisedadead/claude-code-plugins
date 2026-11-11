import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'

const CLI = join(import.meta.dirname, '..', 'skills', 'skill-smith', 'scripts', 'lint-skill-cli.ts')
const SKILL = '---\nname: foo\ndescription: Use when a test needs a skill.\n---\n# foo\n\nSee [deep](reference/a/deep.md).\n'

function lint(cwd: string, ...args: string[]) {
  return spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8' })
}

test('walks a real skill tree without following a symlinked directory', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-skill-'))
  try {
    const skill = join(root, 'skills', 'foo')
    mkdirSync(join(skill, 'reference', 'a'), { recursive: true })
    writeFileSync(join(skill, 'SKILL.md'), SKILL)
    writeFileSync(join(skill, 'reference', 'a', 'deep.md'), 'x\n')
    mkdirSync(join(root, 'elsewhere', 'bar'), { recursive: true })
    writeFileSync(join(root, 'elsewhere', 'bar', 'SKILL.md'), '---\nname: wrong\n---\n')
    symlinkSync(join(root, 'elsewhere'), join(root, 'skills', 'linked'))
    const result = lint(root, 'skills')
    assert.match(result.stdout, /WARN foo: reference nested too deep \(reference\/a\/deep\.md\)/)
    assert.doesNotMatch(result.stdout, /wrong/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('names the parent directory through a ./ segment', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-skill-'))
  try {
    mkdirSync(join(root, 'sk', 'foo'), { recursive: true })
    writeFileSync(join(root, 'sk', 'foo', 'SKILL.md'), '---\nname: foo\ndescription: Use when a test needs a skill.\n---\n# foo\n')
    const result = lint(root, 'sk/foo/./SKILL.md')
    assert.equal(result.status, 0, result.stdout + result.stderr)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('a skills directory warns on a shared trigger phrase and keeps exit 0', () => {
  const root = mkdtempSync(join(tmpdir(), 'lint-skill-'))
  try {
    for (const name of ['foo', 'bar']) {
      mkdirSync(join(root, 'skills', name), { recursive: true })
      const description = `Does ${name}. Use when the user says "tidy up".`
      writeFileSync(join(root, 'skills', name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\n# ${name}\n`)
    }
    const result = lint(root, 'skills')
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /WARN bar: trigger phrase "tidy up" is also in foo/)
    assert.match(result.stdout, /WARN foo: trigger phrase "tidy up" is also in bar/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
