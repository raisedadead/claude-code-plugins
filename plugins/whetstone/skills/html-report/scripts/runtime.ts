import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

type Env = Readonly<Record<string, string | undefined>>

const BROWSERS = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
] as const

export function findChrome(env: Env, exists: (path: string) => boolean): string | undefined {
  const pinned = env.PUPPETEER_EXECUTABLE_PATH
  if (pinned) return exists(pinned) ? pinned : undefined
  return BROWSERS.find(exists)
}

export function depsHome(env: Env): string {
  const data = env.CLAUDE_PLUGIN_DATA || join(env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'whetstone')
  return join(data, 'html-report')
}

export function ensureDeps(skillDir: string, depsDir: string, install: (dir: string) => void): boolean {
  const lock = readFileSync(join(skillDir, 'package-lock.json'))
  const digest = createHash('sha256').update(lock).digest('hex')
  const stamp = join(depsDir, '.lock-sha256')
  if (existsSync(join(depsDir, 'node_modules')) && existsSync(stamp) && readFileSync(stamp, 'utf8') === digest) return false
  mkdirSync(depsDir, { recursive: true })
  for (const name of ['package.json', 'package-lock.json']) copyFileSync(join(skillDir, name), join(depsDir, name))
  install(depsDir)
  writeFileSync(stamp, digest)
  return true
}
