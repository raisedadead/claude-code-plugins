import type * as fs from 'node:fs'

export const io: { stdin: string; sink: ((text: string) => void) | undefined } = { stdin: '', sink: undefined }

export function fsWithStdio(real: typeof fs): typeof fs {
  const readFileSync = ((path: unknown, ...rest: unknown[]) =>
    path === 0 ? io.stdin : (real.readFileSync as (...args: unknown[]) => unknown)(path, ...rest)) as typeof fs.readFileSync
  const writeSync = ((fd: number, data: unknown, ...rest: unknown[]) => {
    if (io.sink && fd === 1 && typeof data === 'string' && rest.length === 0) {
      io.sink(data)
      return Buffer.byteLength(data)
    }
    return (real.writeSync as (...args: unknown[]) => number)(fd, data, ...rest)
  }) as typeof fs.writeSync
  return { ...real, default: { ...real, readFileSync, writeSync }, readFileSync, writeSync } as typeof fs
}
