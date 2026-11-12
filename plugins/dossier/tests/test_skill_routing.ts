import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'vitest'
import { splitLines, strip } from '../engine/text.ts'

const SKILLS = join(import.meta.dirname, '..', 'skills')
const MARKERS = ['invoke when', 'use when']

function field(frontmatter: string, key: string): string {
  for (const line of splitLines(frontmatter)) {
    const stripped = strip(line)
    if (!stripped.startsWith(`${key}:`)) continue
    const value = strip(stripped.slice(key.length + 1))
    const quoted = value.length >= 2 && value[0] === value.at(-1) && (value[0] === '"' || value[0] === "'")
    return quoted ? value.slice(1, -1) : value
  }
  return ''
}

function phrases(description: string): string[] {
  const lower = description.toLowerCase()
  const starts = MARKERS.map((marker) => lower.indexOf(marker)).filter((at) => at >= 0)
  if (!starts.length) return []
  const tail = description.slice(Math.min(...starts))
  return [...tail.matchAll(/"([^"]+)"/g)].map((match) => strip(match[1] ?? '').toLowerCase()).filter(Boolean)
}

function lint(dir: string): string[] {
  const skills: [string, string][] = []
  for (const child of readdirSync(dir).sort()) {
    const path = join(dir, child, 'SKILL.md')
    try {
      if (!statSync(path).isFile()) continue
    } catch {
      continue
    }
    const parts = readFileSync(path, 'utf8').split('---')
    if (parts.length < 3) continue
    const name = field(parts[1] ?? '', 'name')
    const description = field(parts[1] ?? '', 'description')
    if (name && description) skills.push([name, description])
  }
  const findings = skills
    .filter(([, description]) => !MARKERS.some((marker) => description.toLowerCase().includes(marker)))
    .map(([name]) => `FAIL ${name}: description has no 'Invoke when' / 'Use when' trigger clause`)
  const owners = new Map<string, string[]>()
  for (const [name, description] of skills) {
    for (const phrase of new Set(phrases(description))) owners.set(phrase, [...(owners.get(phrase) ?? []), name])
  }
  for (const [phrase, names] of [...owners].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (names.length > 1) findings.push(`FAIL trigger-phrase collision: "${phrase}" claimed by ${names.sort().join(', ')}`)
  }
  return findings
}

test('the shipped skill descriptions lint clean', () => {
  assert.deepEqual(lint(SKILLS), [])
})
