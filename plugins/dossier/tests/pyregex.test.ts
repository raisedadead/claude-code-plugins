import { describe, expect, test } from 'claude-code/testing'
import { compilePython, fnmatch } from '../engine/pyregex.ts'

function matches(pattern: string, text: string): boolean | undefined {
  return compilePython(pattern)?.test(text)
}

describe('compilePython', () => {
  test('translates named groups and their backreferences', () => {
    expect(matches('(?P<q>[\'"])x(?P=q)', '"x"')).toBe(true)
    expect(matches('(?P<q>[\'"])x(?P=q)', '"x\'')).toBe(false)
  })

  test('turns leading inline flags into JS flags', () => {
    expect(matches('(?i)eval\\(', 'EVAL(')).toBe(true)
    expect(matches('(?s)a.b', 'a\nb')).toBe(true)
    expect(matches('(?m)^b', 'a\nb')).toBe(true)
  })

  test('keeps Python anchors: $ before a final newline, \\A and \\Z at the text edges', () => {
    expect(matches('foo$', 'x foo\n')).toBe(true)
    expect(matches('foo$', 'foo\nbar')).toBe(false)
    expect(matches('\\Aimport', 'import x')).toBe(true)
    expect(matches('\\Aimport', 'x\nimport')).toBe(false)
    expect(matches('end\\Z', 'the end')).toBe(true)
    expect(matches('end\\Z', 'the end\n')).toBe(false)
  })

  test('reads \\w, \\d and escaped punctuation as Python does', () => {
    expect(matches('^\\w+$', 'héllo')).toBe(true)
    expect(matches('\\d', '٣')).toBe(true)
    expect(matches('a\\:b', 'a:b')).toBe(true)
  })

  test('keeps Python line semantics for ., ^ and $ around \\r', () => {
    expect(matches('(?m)a$', 'a\rb')).toBe(false)
    expect(matches('(?m)^b', 'a\rb')).toBe(false)
    expect(matches('a.b', 'a\rb')).toBe(true)
    expect(matches('a.b', 'a\nb')).toBe(false)
  })

  test('reads \\B as Unicode and (?u) as a no-op', () => {
    expect(matches('a\\Bé', 'aé')).toBe(true)
    expect(matches('(?u)eval', 'eval')).toBe(true)
  })

  test('skips a pattern with no JS meaning', () => {
    expect(compilePython('[\\W]x')).toBeUndefined()
    expect(compilePython('(?x) a b')).toBeUndefined()
    expect(compilePython('a{')).toBeUndefined()
    expect(compilePython('(?<=a+)b')).toBeDefined()
  })
})

describe('fnmatch', () => {
  test('lets * cross a slash, as Python fnmatch does', () => {
    expect(fnmatch('src/a/b.py', 'src/*.py')).toBe(true)
    expect(fnmatch('lib/a.py', 'src/*.py')).toBe(false)
  })

  test('reads ?, classes and negated classes', () => {
    expect(fnmatch('a1.py', 'a?.py')).toBe(true)
    expect(fnmatch('b.py', '[!a].py')).toBe(true)
    expect(fnmatch('a.py', '[!a].py')).toBe(false)
    expect(fnmatch('[.py', '[.py')).toBe(true)
    expect(fnmatch(']', '[]]')).toBe(true)
    expect(fnmatch('a', '[]a]')).toBe(true)
    expect(fnmatch('b', '[!]]')).toBe(true)
    expect(fnmatch(']', '[!]]')).toBe(false)
  })
})
