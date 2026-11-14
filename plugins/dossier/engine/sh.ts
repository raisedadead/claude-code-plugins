import { spawnSync } from 'node:child_process'

export class Refusal extends Error {
  readonly code: number
  constructor(message: string, code = 1) {
    super(message)
    this.code = code
  }
}

export type Ran = { code: number; out: string; err: string }

export function run(argv: string[], cwd: string, opts: { input?: string; env?: Record<string, string>; timeoutMs?: number } = {}): Ran {
  const [command = 'true', ...args] = argv
  const done = spawnSync(command, args, {
    cwd,
    input: opts.input,
    encoding: 'utf8',
    env: { ...process.env, ...opts.env },
    timeout: opts.timeoutMs,
    maxBuffer: 64 << 20,
  })
  const code = done.status ?? (done.error ? 127 : 124)
  return { code, out: done.stdout ?? '', err: done.stderr || (done.error?.message ?? '') }
}

export function gitTry(cwd: string, ...args: string[]): Ran {
  return run(['git', ...args], cwd)
}

export function git(cwd: string, ...args: string[]): string {
  const done = gitTry(cwd, ...args)
  if (done.code !== 0) throw new Refusal(`git ${args.join(' ')}: ${done.err.trim() || `exit ${done.code}`}`)
  return done.out.trim()
}

export function lines(text: string): string[] {
  return text.split('\n').filter(Boolean)
}
