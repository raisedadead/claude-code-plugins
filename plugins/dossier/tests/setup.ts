import { vi } from 'vitest'
import './git_env.ts'

vi.mock('node:fs', async (original) => {
  const { fsWithStdio } = await import('./stdio.ts')
  return fsWithStdio(await original<typeof import('node:fs')>())
})
