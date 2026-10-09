import { describe, expect, test } from 'claude-code/testing'
import { lintSkill } from '../skills/skill-smith/scripts/lint-skill.ts'

const skill = (frontmatter: string, body = 'body\n') => `---\n${frontmatter}\n---\n\n${body}`
const has = (findings: string[], fn: (f: string) => boolean) => findings.some(fn)

describe('lint-skill', () => {
  test('passes a well-formed skill', () => {
    const text = skill('name: good-skill\ndescription: Does a good thing. Use when the user asks to do good.')
    expect(lintSkill(text, 'good-skill', [])).toEqual([])
  })

  test('fails a skill with no frontmatter', () => {
    expect(lintSkill('just text\n', 's', [])).toEqual(['FAIL s: no YAML frontmatter (--- … ---)'])
  })

  test('fails an unquoted value holding a colon-space', () => {
    const text = skill('name: backprop\ndescription: Traces a root cause. Invoke when the user says "bug: <description>".')
    expect(has(lintSkill(text, 'backprop', []), (f) => f.startsWith('FAIL') && f.includes('YAML-safe'))).toBe(true)
  })

  test('fails an unquoted value opening with a flow indicator', () => {
    const text = skill('name: ship\ndescription: Ships it. Use when the user asks to ship.\nargument-hint: [--preview] [--changelog <path>]')
    expect(has(lintSkill(text, 'ship', []), (f) => f.startsWith('FAIL') && f.includes('YAML-safe'))).toBe(true)
  })

  test('passes quoted values and a plain pipe', () => {
    const quoted = skill("name: quoted\ndescription: 'Does it. Use when the user says \"bug: <x>\".'\nargument-hint: '[--preview] | --all'")
    const piped = skill('name: build\ndescription: Builds. Use when the user asks to build.\nargument-hint: <T-id> | --next | --auto')
    expect(has(lintSkill(quoted, 'quoted', []), (f) => f.includes('YAML-safe'))).toBe(false)
    expect(has(lintSkill(piped, 'build', []), (f) => f.includes('YAML-safe'))).toBe(false)
  })

  test('reads a block-scalar description whole', () => {
    const literal = skill('name: s\ndescription: |\n  Does a thing.\n  Use when asked.')
    const folded = skill('name: s\ndescription: >-\n  Does a thing.\n  Use when asked.')
    expect(lintSkill(literal, 's', [])).toEqual([])
    expect(lintSkill(folded, 's', [])).toEqual([])
  })

  test('fails a block-scalar description with no trigger', () => {
    const text = skill('name: s\ndescription: |\n  Does a thing.\n  Then another.\nargument-hint: x')
    expect(lintSkill(text, 's', [])).toEqual(["FAIL s: description has no 'Use when' / 'Invoke when' trigger clause"])
  })

  test('fails a name that differs from its directory', () => {
    const findings = lintSkill(skill('name: wrong-name\ndescription: Thing. Use when asked.'), 'good-skill', [])
    expect(findings).toEqual(["FAIL good-skill: name 'wrong-name' does not match parent dir 'good-skill'"])
  })

  test('fails a name outside the kebab charset', () => {
    const findings = lintSkill(skill('name: Bad_Name\ndescription: Thing. Use when asked.'), 'Bad_Name', [])
    expect(has(findings, (f) => f.startsWith('FAIL') && f.includes('kebab'))).toBe(true)
  })

  test('fails a missing or overlong description and a missing trigger', () => {
    expect(lintSkill(skill('name: s'), 's', [])).toEqual(['FAIL s: frontmatter has no description'])
    const noTrigger = lintSkill(skill('name: s\ndescription: Does a thing with no trigger clause.'), 's', [])
    expect(noTrigger).toEqual(["FAIL s: description has no 'Use when' / 'Invoke when' trigger clause"])
    const long = lintSkill(skill(`name: s\ndescription: Use when ${'x'.repeat(1100)}`), 's', [])
    expect(has(long, (f) => f.startsWith('FAIL s: description is 1109 chars'))).toBe(true)
  })

  test('warns on first-person narration and ignores a quoted I', () => {
    const narrated = lintSkill(skill('name: s\ndescription: I help you fix things. Use when asked.'), 's', [])
    expect(has(narrated, (f) => f.startsWith('WARN') && f.includes('first-person'))).toBe(true)
    const quoted = skill('name: s\ndescription: Correct a slip. Use when the user says "I asked you to X", "you forgot".')
    expect(lintSkill(quoted, 's', [])).toEqual([])
  })

  test('fails a body past 500 lines and warns past 400', () => {
    const body = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`).join('\n') + '\n'
    const front = 'name: s\ndescription: Thing. Use when asked.'
    expect(has(lintSkill(skill(front, body(600)), 's', []), (f) => f.startsWith('FAIL') && f.includes('(>500)'))).toBe(true)
    expect(has(lintSkill(skill(front, body(450)), 's', []), (f) => f.startsWith('WARN') && f.includes('500'))).toBe(true)
    expect(lintSkill(skill(front, body(390)), 's', [])).toEqual([])
  })

  test('warns on a reference nested two levels deep and skips hidden files', () => {
    const front = skill('name: s\ndescription: Thing. Use when asked.')
    const deep = lintSkill(front, 's', ['SKILL.md', 'reference/a.md', 'reference/nested/x.md'])
    expect(deep).toEqual(['WARN s: reference nested too deep (reference/nested/x.md); keep references one level deep'])
    expect(lintSkill(front, 's', ['scripts/__pycache__/x.pyc', '.cache/a/b'])).toEqual([])
  })
})
