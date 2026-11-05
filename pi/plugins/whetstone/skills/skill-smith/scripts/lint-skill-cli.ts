import { readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'
import { byCodePoint } from '../../../hooks/text.ts'
import { lintSkill } from './lint-skill.ts'

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function filesUnder(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true })
    .sort((a, b) => byCodePoint(a.name, b.name))
    .flatMap((entry) => {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) return filesUnder(dir, rel)
      return isFile(join(dir, rel)) ? [rel] : []
    })
}

function byParts(a: string, b: string): number {
  const left = a.split(sep)
  const right = b.split(sep)
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const x = left[i] ?? ''
    const y = right[i] ?? ''
    if (x !== y) return byCodePoint(x, y)
  }
  return left.length - right.length
}

function parentName(dir: string): string {
  return (
    dir
      .split(sep)
      .filter((part) => part !== '' && part !== '.')
      .pop() ?? ''
  )
}

function lintFile(skillMd: string): string[] {
  const dir = dirname(skillMd)
  return lintSkill(readFileSync(skillMd, 'utf8'), parentName(dir), filesUnder(dir))
}

function lintTarget(target: string): string[] {
  if (!statSync(target).isDirectory()) return lintFile(target)
  return filesUnder(target)
    .filter((rel) => basename(rel) === 'SKILL.md')
    .map((rel) => join(target, rel))
    .sort(byParts)
    .flatMap(lintFile)
}

const targets = process.argv.length > 2 ? process.argv.slice(2) : [process.cwd()]
const findings = targets.flatMap(lintTarget)
for (const finding of findings) console.log(finding)
process.exitCode = findings.some((f) => f.startsWith('FAIL')) ? 1 : 0
