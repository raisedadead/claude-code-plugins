import { splitLines, strip, unicodeRegex } from '../../../hooks/text.ts'

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const FIRST_PERSON = unicodeRegex("\\bI\\b|\\bI'")
const TRIGGER_MARKERS = ['use when', 'invoke when']
const YAML_INDICATORS = '[]{}*&!%@`>|'
const LINE_BUDGET = 500
const LINE_WARN = 400
const DESC_MAX = 1024

function unquoted(value: string): string {
  const quoted = value.length >= 2 && value[0] === value[value.length - 1] && `"'`.includes(value[0] ?? '')
  return quoted ? value.slice(1, -1) : value
}

function field(frontmatter: string, key: string): string {
  for (const line of splitLines(frontmatter)) {
    const stripped = strip(line)
    if (stripped.startsWith(`${key}:`)) return unquoted(strip(stripped.slice(key.length + 1)))
  }
  return ''
}

function yamlHazards(frontmatter: string): string[] {
  const bad: string[] = []
  for (const line of splitLines(frontmatter)) {
    const stripped = strip(line)
    if (!stripped || stripped.startsWith('#') || !stripped.includes(':')) continue
    const colon = stripped.indexOf(':')
    const key = stripped.slice(0, colon)
    if (!key || strip(key).includes(' ')) continue
    const value = strip(stripped.slice(colon + 1))
    if (!value || unquoted(value) !== value) continue
    if (YAML_INDICATORS.includes(value[0] ?? '')) bad.push(`${strip(key)} (opens with '${value[0]}')`)
    else if (value.includes(': ')) bad.push(`${strip(key)} (contains a colon-space)`)
  }
  return bad
}

function nameFindings(name: string, hint: string): string[] {
  if (!name) return [`FAIL ${hint}: frontmatter has no name`]
  const found: string[] = []
  if (name !== hint) found.push(`FAIL ${hint}: name '${name}' does not match parent dir '${hint}'`)
  if (!NAME.test(name)) {
    found.push(
      `FAIL ${hint}: name '${name}' breaks the kebab charset ` +
        '(lowercase/digits/hyphen, no leading/trailing/double hyphen)',
    )
  }
  return found
}

function descriptionFindings(description: string, hint: string): string[] {
  if (!description) return [`FAIL ${hint}: frontmatter has no description`]
  const found: string[] = []
  const length = [...description].length
  if (length > DESC_MAX) found.push(`FAIL ${hint}: description is ${length} chars (>${DESC_MAX})`)
  if (!TRIGGER_MARKERS.some((marker) => description.toLowerCase().includes(marker))) {
    found.push(`FAIL ${hint}: description has no 'Use when' / 'Invoke when' trigger clause`)
  }
  if (FIRST_PERSON.test(description.replace(/"[^"]*"/g, ''))) {
    found.push(`WARN ${hint}: description reads first-person ('I …'); skills are described in the third person`)
  }
  return found
}

function bodyFindings(body: string, hint: string): string[] {
  const lines = splitLines(body).length
  if (lines > LINE_BUDGET) return [`FAIL ${hint}: body is ${lines} lines (>${LINE_BUDGET})`]
  if (lines > LINE_WARN) return [`WARN ${hint}: body is ${lines} lines (nearing the ${LINE_BUDGET} budget)`]
  return []
}

function depthFindings(files: string[], hint: string): string[] {
  return files
    .map((rel) => rel.split('/'))
    .filter((parts) => !parts.some((part) => part === '__pycache__' || part.startsWith('.')))
    .filter((parts) => parts.length > 2)
    .map((parts) => `WARN ${hint}: reference nested too deep (${parts.join('/')}); keep references one level deep`)
}

export function lintSkill(text: string, nameHint: string, files: string[]): string[] {
  const parts = text.split('---')
  if (parts.length < 3) return [`FAIL ${nameHint}: no YAML frontmatter (--- … ---)`]
  const frontmatter = parts[1] ?? ''
  const body = parts.slice(2).join('---')
  return [
    ...yamlHazards(frontmatter).map(
      (hazard) =>
        `FAIL ${nameHint}: frontmatter value is not YAML-safe unquoted — ${hazard}. ` +
        'Wrap it in single quotes; the host drops every field when the block fails to parse.',
    ),
    ...nameFindings(field(frontmatter, 'name'), nameHint),
    ...descriptionFindings(field(frontmatter, 'description'), nameHint),
    ...bodyFindings(body, nameHint),
    ...depthFindings(files, nameHint),
  ]
}
