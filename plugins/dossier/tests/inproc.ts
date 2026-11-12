import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'
import { main } from '../cli/dispatch.ts'
import { io } from './stdio.ts'

export interface Run {
  code: number
  stdout: string
  stderr: string
}

const SAVED = ['PWD', 'DOSSIER_LEDGER_ROOT', 'DOSSIER_SCRATCHPAD_ROOT'] as const

export function tempRoot(prefix: string, ledger = false): { dir: string; clean: () => void } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)))
  if (ledger) mkdirSync(join(dir, '.scratchpad', 'dossier'), { recursive: true })
  return { dir, clean: () => rmSync(dir, { recursive: true, force: true }) }
}

function text(chunk: unknown): string {
  return typeof chunk === 'string' ? chunk : Buffer.from(chunk as Uint8Array).toString('utf8')
}

export async function ds(cwd: string, args: string[], env: Readonly<Record<string, string>> = {}, input = ''): Promise<Run> {
  const home = process.cwd()
  const saved = new Map<string, string | undefined>([...SAVED, ...Object.keys(env)].map((name) => [name, process.env[name]]))
  const writers = { log: console.log, error: console.error, write: process.stdout.write }
  let stdout = ''
  let stderr = ''
  io.stdin = input
  io.sink = (chunk) => {
    stdout += chunk
  }
  console.log = (...parts: unknown[]) => {
    stdout += `${format(...parts)}\n`
  }
  console.error = (...parts: unknown[]) => {
    stderr += `${format(...parts)}\n`
  }
  process.stdout.write = ((chunk: unknown) => {
    stdout += text(chunk)
    return true
  }) as typeof process.stdout.write
  try {
    for (const name of SAVED.slice(1)) delete process.env[name]
    Object.assign(process.env, env, { PWD: cwd })
    process.chdir(cwd)
    const code = await main(args)
    return { code, stdout, stderr }
  } finally {
    io.stdin = ''
    io.sink = undefined
    console.log = writers.log
    console.error = writers.error
    process.stdout.write = writers.write
    process.chdir(home)
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}
