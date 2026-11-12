import { join } from 'node:path'
import { vi } from 'vitest'

process.env.NODE_COMPILE_CACHE ??= join(import.meta.dirname, '..', '..', '..', 'node_modules', '.cache', 'dossier-tests-compile-cache')

Object.assign(process.env, {
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_COUNT: '3',
  GIT_CONFIG_KEY_0: 'maintenance.auto',
  GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.excludesFile',
  GIT_CONFIG_VALUE_1: '/dev/null',
  GIT_CONFIG_KEY_2: 'core.attributesFile',
  GIT_CONFIG_VALUE_2: '/dev/null',
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
})

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>()
  const { io } = await import('./stdio.ts')
  const readFileSync = ((path: unknown, ...rest: unknown[]) =>
    path === 0 ? io.stdin : (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest)) as typeof fs.readFileSync
  const writeSync = ((fd: number, data: unknown, ...rest: unknown[]) => {
    if (io.sink && fd === 1 && typeof data === 'string' && rest.length === 0) {
      io.sink(data)
      return Buffer.byteLength(data)
    }
    return (fs.writeSync as (...args: unknown[]) => number)(fd, data, ...rest)
  }) as typeof fs.writeSync
  return { ...fs, default: { ...fs, readFileSync, writeSync }, readFileSync, writeSync }
})
