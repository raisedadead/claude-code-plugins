import type { EngineInterface, Register } from 'claude-code'
import { lintSkill, sharedTriggers } from '../skills/skill-smith/scripts/lint-skill.ts'

const SKILL_FILE = /^(.*)\/skills\/([^/]+)\/SKILL\.md$/

async function siblingSkills($: EngineInterface, folder: string, name: string): Promise<{ name: string; text: string }[]> {
  let others: string[]
  try {
    others = (await $.fs.list(folder)).map((entry) => entry.name).filter((other) => other !== name)
  } catch {
    return []
  }
  const found = await Promise.all(
    others.map(async (other) => {
      try {
        return [{ name: other, text: String(await $.fs.read(`${folder}/${other}/SKILL.md`)) }]
      } catch {
        return []
      }
    }),
  )
  return found.flat()
}

async function skillLintReminder($: EngineInterface, path: string): Promise<string | undefined> {
  const found = SKILL_FILE.exec(path)
  const name = found?.[2]
  if (!found || !name) return undefined
  let text: string
  try {
    text = String(await $.fs.read(path))
  } catch {
    return undefined
  }
  const shared = sharedTriggers([{ name, text }, ...(await siblingSkills($, `${found[1]}/skills`, name))])
  const lines = [...lintSkill(text, name, []), ...shared.filter((line) => line.startsWith(`WARN ${name}:`))]
  if (!lines.length) return undefined
  return `skill-smith lint for ${path}:\n${lines.join('\n')}\nReminder only, never blocking; whetstone:skill-smith holds the rubric.`
}

export const register: Register = (on) => {
  on('classic.PostToolUse', async ($, e, next) => {
    const result = await next(e)
    if (e.tool_name !== 'Edit' && e.tool_name !== 'Write') return result
    const input = (e.tool_input ?? {}) as Record<string, unknown>
    const path = typeof input.file_path === 'string' ? input.file_path : ''
    const context = await skillLintReminder($, path)
    if (!context) return result
    return { ...result, additionalContext: [...(result.additionalContext ?? []), context] }
  })
}
