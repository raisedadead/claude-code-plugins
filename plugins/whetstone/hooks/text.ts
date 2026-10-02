const WORD_SET = '\\p{L}\\p{N}_'
const SPACE_SET = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const DIGIT_SET = '\\p{Nd}'
const WORD = `[${WORD_SET}]`
const BOUNDARY = `(?:(?<=${WORD})(?!${WORD})|(?<!${WORD})(?=${WORD}))`
const LINE_BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/
const EDGE_SPACE = new RegExp(`^[${SPACE_SET}]+|[${SPACE_SET}]+$`, 'gu')

const IN_CLASS: Record<string, string> = { w: WORD_SET, s: SPACE_SET, d: DIGIT_SET }
const OUTSIDE: Record<string, string> = {
  w: WORD,
  s: `[${SPACE_SET}]`,
  d: `[${DIGIT_SET}]`,
  b: BOUNDARY,
}

export function unicodeRegex(source: string, flags = ''): RegExp {
  let out = ''
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? ''
    if (char === '\\') {
      const next = source[i + 1] ?? ''
      i++
      const table = inClass ? IN_CLASS : OUTSIDE
      out += table[next] ?? `\\${next}`
      continue
    }
    if (char === '[' && !inClass) inClass = true
    else if (char === ']' && inClass) inClass = false
    out += char
  }
  return new RegExp(out, `${flags}u`)
}

export function strip(text: string): string {
  return text.replace(EDGE_SPACE, '')
}

export function splitLines(text: string): string[] {
  if (!text) return []
  const lines = text.split(LINE_BREAK)
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}
