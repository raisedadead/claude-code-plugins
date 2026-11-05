import { homedir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Edit } from '../engine/guards.ts'
import { pluginRoot } from './io.ts'

export function nativePath(path: string, cwd: string): string {
  const raw = path.replace(/^@/, '').replace(/[\u00a0\u2000-\u200a\u202f\u205f\u3000]/g, ' ')
  const local = raw.startsWith('file://') ? fileURLToPath(raw) : raw
  return local === '~' ? homedir() : local.startsWith('~/') ? resolve(homedir(), local.slice(2)) : resolve(cwd, local)
}

export function normalizeMutation(tool: string, input: Record<string, unknown>, cwd: string): Edit | undefined {
  if ((tool !== 'edit' && tool !== 'write') || typeof input.path !== 'string') return undefined
  const chunks: string[] = []
  if (tool === 'write') {
    if (typeof input.content === 'string') chunks.push(input.content)
  } else {
    if (Array.isArray(input.edits)) {
      for (const edit of input.edits as unknown[]) {
        if (edit && typeof edit === 'object' && 'newText' in edit && typeof edit.newText === 'string') chunks.push(edit.newText)
      }
    }
    if (typeof input.newText === 'string') chunks.push(input.newText)
  }
  return chunks.length ? { filePath: nativePath(input.path, cwd), chunks } : undefined
}

export function skillName(name: string, location = ''): string {
  if (name.startsWith('skill:')) name = name.slice(6)
  if (name.startsWith('ds-')) return `dossier:${name.slice(3)}`
  if (name.startsWith('dossier-')) return `dossier:${name.slice(8)}`
  if (name.startsWith('whetstone-')) return `whetstone:${name.slice(10)}`
  if (location.startsWith(resolve(pluginRoot, 'skills') + '/') || /\/dossier\/skills\//.test(location)) return `dossier:${name.replace(/^dossier:/, '')}`
  if (/\/whetstone\/skills\//.test(location)) return `whetstone:${name.replace(/^whetstone:/, '')}`
  return name
}

export function skillFromPath(path: string): string | undefined {
  return basename(path) === 'SKILL.md' ? skillName(basename(dirname(path)), path) : undefined
}
