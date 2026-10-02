import { splitLines, strip, unicodeRegex } from './text.ts'

const CLAIM = unicodeRegex(
  '(?:`[^`]+`' +
    '|\\b(?:the|this)\\s+(?:runner|hook|script|gate|check(?:er)?|guard|linter)\\b)' +
    '\\s+(?:\\w[\\w-]*\\s+){0,3}?' +
    '(?:hard-)?(?:blocks|enforces|gates|denies|prevents|refuses)\\b' +
    '(?!\\s+\\w+ed\\b)',
  'i',
)

const BACKED = unicodeRegex(
  '\\bexits?\\s+\\d+\\b|\\bexit\\s+cod\\w*\\b|\\breturn(?:s|ing)?\\s+exit\\b' +
    '|\\bnon-zero\\b|\\bexit-code\\b|https?://|#\\d{2,}',
  'i',
)

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

export function scanText(text: string, label: string): string[] {
  return units(text)
    .filter(([, unit]) => CLAIM.test(unit) && !BACKED.test(unit) && !LABELLED.test(unit))
    .map(([number, unit]) => `${label}:${number}: ${shown(unit)}`)
}

export function flaggedVerdict(count: number): string {
  return `CLAIMS: FLAGGED ${count}`
}
