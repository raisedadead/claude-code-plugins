import { splitLines, strip, unicodeRegex } from './text.ts'

const VERB = '(?:hard-)?(?:blocks|enforces|gates|denies|prevents|refuses)\\b'
const FILLER = '\\s+(?:\\w[\\w-]*\\s+){0,3}?(?<!\\bno longer\\s)'
const MACHINE = '(?:runner|hook|script|gate|check(?:er)?|guard|linter)\\b'
const NOUN = '(?!\\s*(?:[.,;:!?…)|]|$)|\\s+(?:are|is|was|were|of)\\b)'

const CLAIM = unicodeRegex(
  '(?:`[^`]+`' +
    FILLER +
    '(?:hard-)?(?:enforces|prevents|refuses|(?:blocks|gates|denies)\\b' +
    NOUN +
    ')\\b' +
    '|`[^`]+`\\s+' +
    MACHINE +
    FILLER +
    VERB +
    '|\\b(?:the|this)\\s+' +
    MACHINE +
    FILLER +
    VERB +
    ')(?!\\s+\\w+ed\\b)',
  'i',
)

const UNVERIFIED = /^(?:[-*]\s+)?UNVERIFIED:/u

const BACKED = unicodeRegex(
  '\\bexits?\\s+\\d+\\b|\\bexit\\s+cod\\w*\\b|\\breturn(?:s|ing)?\\s+exit\\b' + '|\\bnon-zero\\b|\\bexit-code\\b|https?://|#\\d{2,}',
  'i',
)

const CITATION = unicodeRegex(
  '(?<![\\w./~-])([\\w.~-]*/[\\w./~-]*' + '|[\\w.~-]*\\.(?:[cm]?[jt]sx?|py|sh|zsh|fish|md|json|jsonc|toml|ya?ml|tmpl|rs|go|rb|lua|css|html|txt)):\\d+\\b',
  'gi',
)

const isPath = (token: string): boolean => token.includes('.') || token.split('/').length > 2

const backed = (unit: string): boolean => BACKED.test(unit) || [...unit.matchAll(CITATION)].some(([, token = '']) => isPath(token))

const LABELLED = unicodeRegex(
  '\\badvisory\\b|\\bmodel[\\s-]judge?ment\\b|\\bopt-in\\b|\\bnag\\b' +
    '|\\bnon-blocking\\b|\\bnever blocks\\b|\\bblocks nothing\\b|\\bdoes not block\\b' +
    '|\\bnot a gate\\b' +
    '|\\bcode\\s*[—–-]\\s*`[^`]+`',
  'i',
)

const SENTENCE_END = unicodeRegex('(?<=[.!?])\\s+')
const SHOWN_MAX = 110

function units(text: string): Array<[number, string]> {
  const found: Array<[number, string]> = []
  splitLines(text).forEach((line, index) => {
    const stripped = strip(line)
    if (!stripped) return
    if (stripped.startsWith('|')) {
      found.push([index + 1, stripped])
      return
    }
    for (const piece of stripped.split(SENTENCE_END)) {
      if (strip(piece)) found.push([index + 1, strip(piece)])
    }
  })
  return found
}

function shown(unit: string): string {
  const points = [...unit]
  if (points.length <= SHOWN_MAX) return unit
  return points.slice(0, SHOWN_MAX - 3).join('') + '...'
}

export function flaggedUnits(text: string): [number, string][] {
  return units(text)
    .filter(([, unit]) => CLAIM.test(unit) && !backed(unit) && !LABELLED.test(unit) && !UNVERIFIED.test(unit))
    .map(([number, unit]) => [number, shown(unit)])
}

export function scanText(text: string, label: string): string[] {
  return flaggedUnits(text).map(([number, unit]) => `${label}:${number}: ${unit}`)
}
