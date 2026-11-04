import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { isDossierPath } from '../engine/guards.ts'
import { CACHE_TTL_DEFAULT, HTTP_TIMEOUT_S, type Lookup, patterns, type Pin, resolvePin, scan, type Status } from '../engine/verify.ts'

const USER_AGENT = 'dossier-verify/0.2 (+https://github.com/raisedadead/claude-code-plugins)'
const EXIT_USAGE = 2

function say(line: string): void {
  writeSync(1, `${line}\n`)
}

function cacheDir(root: string): string {
  const dir = join(root, '.scratchpad', '.verify-cache')
  try {
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    const fallback = join(process.env.TMPDIR || '/tmp', 'dossier-verify-cache')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

function readEntry(path: string, ttl: number): { status: Status; data: unknown } | undefined {
  try {
    const entry: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return undefined
    const { fetched_at: fetchedAt, data } = entry as Record<string, unknown>
    if (typeof fetchedAt !== 'number' || !('data' in entry)) return undefined
    if (Date.now() / 1000 - fetchedAt >= ttl) return undefined
    return data === null ? { status: 'missing', data: null } : { status: 'ok', data }
  } catch {
    return undefined
  }
}

function writeEntry(path: string, data: unknown): void {
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify({ fetched_at: Date.now() / 1000, data }))
  renameSync(temp, path)
}

function errorName(error: unknown): string {
  return error instanceof Error && error.name === 'TimeoutError' ? 'TimeoutError' : 'URLError'
}

export function cachedLookup(root: string, cacheOnly: boolean): Lookup {
  return async (url, { ttl = CACHE_TTL_DEFAULT, quiet = false, timeout = HTTP_TIMEOUT_S } = {}) => {
    const path = join(cacheDir(root), `${createHash('sha1').update(url).digest('hex')}.json`)
    const hit = readEntry(path, ttl)
    if (hit) return hit
    const offline = { status: 'offline' as const, data: null }
    if (cacheOnly || process.env.DOSSIER_VERIFY_CACHE_ONLY) return offline
    const warn = (why: string) => {
      if (!quiet) console.error(`verify offline: ${url} (${why})`)
      return offline
    }
    let response: Response
    try {
      response = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(timeout * 1000) })
    } catch (error) {
      return warn(errorName(error))
    }
    if (response.status === 404 || response.status === 410) {
      writeEntry(path, null)
      return { status: 'missing', data: null }
    }
    if (!response.ok) return warn(`HTTPError ${response.status}`)
    let data: unknown
    try {
      data = JSON.parse(await response.text())
    } catch (error) {
      return warn(error instanceof SyntaxError ? 'JSONDecodeError' : errorName(error))
    }
    writeEntry(path, data)
    return { status: 'ok', data }
  }
}

function scratchpadRoot(): string {
  return process.env.DOSSIER_SCRATCHPAD_ROOT || process.cwd()
}

function readText(path: string): string | undefined {
  try {
    if (!statSync(path).isFile()) return undefined
    return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n')
  } catch {
    return undefined
  }
}

export async function verifySweepVerb(files: string[]): Promise<number> {
  const rules = patterns(cachedLookup(scratchpadRoot(), false))
  const lines: string[] = []
  for (const file of files) {
    const content = readText(file)
    if (content === undefined) continue
    for (const { rule, finding } of await scan(content, file, rules)) {
      lines.push(`${file}:${rule.name}: ${finding[0]} -> ${finding[1]}  [src: ${finding[2]}]`)
    }
  }
  for (const line of lines) say(line)
  return 0
}

function pyJson(pin: Pin): string {
  const ascii = (value: string | boolean | null) =>
    JSON.stringify(value).replace(/[\u007f-\uffff]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`)
  return `{${Object.entries(pin)
    .map(([key, value]) => `${ascii(key)}: ${ascii(value)}`)
    .join(', ')}}`
}

export async function resolvePinsVerb(specs: string[]): Promise<number> {
  if (!specs.length) {
    console.error('usage: ds resolve-pins <ecosystem>:<pkg> | eol:<slug> ...')
    return EXIT_USAGE
  }
  const lookup = cachedLookup(scratchpadRoot(), false)
  for (const spec of specs) say(pyJson(await resolvePin(lookup, spec)))
  return 0
}

function editInput(): { path: string; content: string } | undefined {
  try {
    const input: unknown = JSON.parse(readFileSync(0, 'utf8'))
    if (typeof input !== 'object' || input === null || Array.isArray(input)) return undefined
    const { file_path: path, content } = input as Record<string, unknown>
    return { path: typeof path === 'string' ? path : '', content: typeof content === 'string' ? content : '' }
  } catch {
    return undefined
  }
}

export async function verifyEditVerb(args: string[]): Promise<number> {
  const root = args[0]
  if (!root) {
    console.error('usage: ds verify-edit <root>')
    return EXIT_USAGE
  }
  const edit = editInput()
  if (!edit?.content || isDossierPath(edit.path)) return 0
  const hits = await scan(edit.content, edit.path, patterns(cachedLookup(root, true)))
  if (!hits.length) return 0
  const lines = hits.map(({ rule, finding, key }) => ({
    key,
    line: `${rule.icon} verify[${rule.name}] ${finding[0]} → ${finding[1]} · src: ${finding[2]}`,
  }))
  say(JSON.stringify(lines))
  return 0
}
