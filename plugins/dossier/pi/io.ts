import { spawn } from 'node:child_process'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Io } from '../hooks/gates.ts'

const MAX_OUTPUT = 1024 * 1024
export const pluginRoot = fileURLToPath(new URL('../', import.meta.url))

export function runBounded(
  argv: string[],
  init: { stdin: string; timeoutMs: number; cwd?: string },
  signal?: AbortSignal,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('dossier process cancelled'))
      return
    }
    const command = argv[0]
    if (!command) {
      reject(new Error('missing command'))
      return
    }
    const child = spawn(command, argv.slice(1), { cwd: init.cwd, detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let size = 0
    let failure: Error | undefined
    const kill = () => {
      if (!child.pid) return
      try {
        if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL')
        else child.kill('SIGKILL')
      } catch {}
    }
    const stop = (message: string) => {
      failure ??= new Error(message)
      kill()
    }
    const abort = () => stop('dossier process cancelled')
    const timer = setTimeout(() => stop('dossier process timed out'), Math.max(1, init.timeoutMs))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    const collect = (text: string, error: boolean) => {
      size += Buffer.byteLength(text)
      if (size > MAX_OUTPUT) {
        stop('dossier process output limit exceeded')
        return
      }
      if (error) stderr += text
      else stdout += text
    }
    child.stdout.on('data', (text: string) => collect(text, false))
    child.stderr.on('data', (text: string) => collect(text, true))
    child.on('error', (error) => {
      failure ??= error
    })
    child.stdin.on('error', () => {})
    child.stdin.end(init.stdin)
    child.on('close', (code) => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      kill()
      if (failure) reject(failure)
      else resolve({ exitCode: code ?? 70, stdout, stderr })
    })
  })
}

function boundedRead<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('dossier filesystem read cancelled'))
      return
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
    }
    const abort = () => {
      cleanup()
      reject(new Error('dossier filesystem read cancelled'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('dossier filesystem read timed out'))
    }, 5000)
    signal?.addEventListener('abort', abort, { once: true })
    operation().then(
      (value) => {
        cleanup()
        resolve(value)
      },
      (error: unknown) => {
        cleanup()
        reject(error)
      },
    )
  })
}

export function nativeIo(signal?: AbortSignal): Io {
  return {
    cli: fileURLToPath(new URL('../cli/ds', import.meta.url)),
    isDir: async (path) => {
      try {
        return (await boundedRead(() => stat(path), signal)).isDirectory()
      } catch {
        return false
      }
    },
    exists: async (path) => {
      try {
        await boundedRead(() => access(path), signal)
        return true
      } catch {
        return false
      }
    },
    read: (path) => boundedRead(() => readFile(path, { encoding: 'utf8', signal }), signal),
    list: (path) => boundedRead(() => readdir(path), signal),
    env: async (name) => process.env[name],
    run: (argv, init) => runBounded(argv, init, signal),
  }
}
