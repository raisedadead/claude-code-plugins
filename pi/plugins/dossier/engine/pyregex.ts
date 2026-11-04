import { unicodeRegex } from './text.ts'

const LEADING_FLAGS = /^\(\?([a-zA-Z]+)\)/
const FLAGS: Record<string, string> = { i: 'i', s: 's', m: 'm', u: '' }
const NEGATED_IN_CLASS = new Set(['W', 'S', 'D'])

function translate(source: string, flags: string): string | undefined {
  const multiline = flags.includes('m')
  const dotAll = flags.includes('s')
  let out = ''
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const char = source[i] ?? ''
    if (char === '\\') {
      const point = source.codePointAt(i + 1) ?? 0
      const next = String.fromCodePoint(point)
      i += next.length
      if (inClass && NEGATED_IN_CLASS.has(next)) return undefined
      if (next === 'A' && !inClass) out += '(?<![\\s\\S])'
      else if (next === 'Z' && !inClass) out += '(?![\\s\\S])'
      else if (/^[\p{L}\p{N}]$/u.test(next)) out += `\\${next}`
      else out += `\\u{${point.toString(16)}}`
      continue
    }
    if (inClass) {
      if (char === ']') inClass = false
      out += char
      continue
    }
    if (char === '[') {
      inClass = true
      out += char
      if (source[i + 1] === '^') out += source[++i]
      if (source[i + 1] === ']') {
        out += '\\]'
        i++
      }
      continue
    }
    if (source.startsWith('(?P<', i)) {
      out += '(?<'
      i += 3
      continue
    }
    const backref = /^\(\?P=(\w+)\)/.exec(source.slice(i))
    if (backref) {
      out += `\\k<${backref[1]}>`
      i += backref[0].length - 1
      continue
    }
    if (char === '.') out += dotAll ? '[\\s\\S]' : '[^\\n]'
    else if (char === '^') out += multiline ? '(?<![^\\n])' : '^'
    else if (char === '$') out += multiline ? '(?![^\\n])' : '(?=\\n?(?![\\s\\S]))'
    else out += char
  }
  return out
}

export function compilePython(pattern: string): RegExp | undefined {
  let flags = ''
  let body = pattern
  const leading = LEADING_FLAGS.exec(pattern)
  if (leading) {
    for (const flag of leading[1] ?? '') {
      const js = FLAGS[flag]
      if (js === undefined) return undefined
      if (!flags.includes(js)) flags += js
    }
    body = pattern.slice(leading[0].length)
  }
  const source = translate(body, flags)
  if (source === undefined) return undefined
  try {
    return unicodeRegex(source, flags.includes('i') ? 'i' : '')
  } catch {
    return undefined
  }
}

function globClass(inner: string): string {
  const negated = inner.startsWith('!')
  const body = (negated ? inner.slice(1) : inner).replaceAll('\\', '\\\\').replaceAll(']', '\\]').replaceAll('[', '\\[')
  if (negated) return `[^${body}]`
  return body.startsWith('^') ? `[\\${body}]` : `[${body}]`
}

export function fnmatch(name: string, glob: string): boolean {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i] ?? ''
    if (char === '*') out += '[\\s\\S]*'
    else if (char === '?') out += '[\\s\\S]'
    else if (char === '[') {
      let j = i + 1
      if (glob[j] === '!') j++
      if (glob[j] === ']') j++
      while (j < glob.length && glob[j] !== ']') j++
      if (j >= glob.length) {
        out += '\\['
        continue
      }
      out += globClass(glob.slice(i + 1, j))
      i = j
    } else out += char.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  }
  try {
    return new RegExp(`^(?:${out})$`, 'u').test(name)
  } catch {
    return false
  }
}
