import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeSync } from 'node:fs'
import { constants } from 'node:os'
import { join } from 'node:path'
import {
  DATE_PREFIX,
  detail,
  field,
  hasConsumer,
  headerToken,
  isCommand,
  layerMix,
  met,
  numberedRows,
  pyRepr,
  readableExpect,
} from '../engine/converge.ts'
import { byCodePoint, splitLines, strip } from '../engine/text.ts'

const MET = 0
const UNMET = 1
const PARSE = 2
const TIMEOUT_SECONDS = 120
const GIT_TIMEOUT_MS = 5000
const DEPTH_VAR = 'DS_CONVERGE_DEPTH'
const MAX_DEPTH = 2
const MAX_BUFFER = 256 * 1024 * 1024

function say(line: string): void {
  writeSync(1, `${line}\n`)
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function visible(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((name) => !name.startsWith('.'))
      .sort(byCodePoint)
  } catch {
    return []
  }
}

function pyPath(path: string): string {
  const lead = path.startsWith('//') && !path.startsWith('///') ? '//' : path.startsWith('/') ? '/' : ''
  const body = path
    .split('/')
    .filter((part) => part !== '' && part !== '.')
    .join('/')
  return lead + body || '.'
}

function liveSlugs(root: string): string[] {
  const dossiers = join(root, '.scratchpad', 'dossier')
  return visible(dossiers).filter((name) => {
    const ledger = join(dossiers, name, 'DOSSIER.md')
    if (!isFile(ledger)) return false
    try {
      return headerToken(readFileSync(ledger, 'utf8')) === 'live'
    } catch {
      return false
    }
  })
}

function contractFor(root: string, slug: string): string | undefined {
  const undated = slug.replace(DATE_PREFIX, '')
  const folder = join(root, '.dossier')
  if (isDir(folder)) {
    for (const name of visible(folder)) {
      if (!name.endsWith('.md') || name === '.md' || !isFile(join(folder, name))) continue
      const stem = name.slice(0, -3)
      if (stem === slug || stem === undated) return join(folder, name)
    }
  }
  const fallback = join(root, '.scratchpad', 'dossier', slug, 'CONTRACT.md')
  return isFile(fallback) ? fallback : undefined
}

function depth(): number {
  const raw = process.env[DEPTH_VAR] ?? '0'
  return /^\s*[+-]?\d+\s*$/.test(raw) ? Math.max(0, Number.parseInt(raw, 10)) : 0
}

function fail(reason: string): number {
  say(`CONVERGE: PARSE — ${reason}`)
  return PARSE
}

function run(command: string, root: string, level: number): { code: number; out: string; err: string } {
  const done = spawnSync('/bin/sh', ['-c', command], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, [DEPTH_VAR]: String(level + 1) },
    maxBuffer: MAX_BUFFER,
    timeout: TIMEOUT_SECONDS * 1000,
    killSignal: 'SIGKILL',
  })
  if ((done.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT') {
    return { code: 124, out: '', err: `timed out after ${TIMEOUT_SECONDS}s` }
  }
  const code = done.signal ? -(constants.signals[done.signal] ?? 1) : (done.status ?? 1)
  return { code, out: done.stdout ?? '', err: done.stderr ?? '' }
}

function resolveContract(root: string): string | number {
  const slugs = liveSlugs(root)
  if (!slugs.length) {
    return fail('no live wave under .scratchpad/dossier/ — a closed wave\'s contract runs only by explicit path')
  }
  const owners = slugs.flatMap((slug) => {
    const contract = contractFor(root, slug)
    return contract ? [{ slug, contract }] : []
  })
  if (!owners.length) return fail(`live wave ${slugs[0]} has no contract — ds:new writes one`)
  if (owners.length > 1) {
    const names = owners.map((owner) => owner.slug).join(', ')
    return fail(`${owners.length} live waves resolve a contract (${names}) — pass the contract path, or pause/close the stale ones`)
  }
  return owners[0]?.contract ?? fail('no contract')
}

export function convergeVerb(args: string[]): number {
  const level = depth()
  if (level >= MAX_DEPTH) return fail(`converge nested ${level} deep; refusing to recurse further`)
  const root = process.cwd()
  const resolved = args[0] === undefined ? resolveContract(root) : pyPath(args[0])
  if (typeof resolved === 'number') return resolved
  const contract = resolved
  if (!isFile(contract)) return fail(`no contract at ${contract}`)
  const text = readFileSync(contract, 'utf8').replace(/\r\n?/g, '\n')
  const rows = numberedRows(text)
  if (!rows.length) return fail('no done-when table, or it holds no numbered rows')
  const home = contract.endsWith('/CONTRACT.md') || contract === 'CONTRACT.md' ? ' (wave-dir, untracked)' : ''
  say(`contract: ${contract}${home}`)
  for (const row of rows) {
    if (row.length !== 3) return fail(`criterion ${row[0]} is not exactly id | command | expect`)
    const [ident = '', command = '', expect = ''] = row
    if (!isCommand(command)) return fail(`criterion ${ident} is not a backticked command: ${pyRepr(command)}`)
    if (!readableExpect(expect)) return fail(`criterion ${ident} has an unreadable expect: ${pyRepr(expect)}`)
  }
  if (!hasConsumer(text)) return fail(`${contract} names no consumer`)
  for (const [ident, command = ''] of rows) say(`will run ${ident}. ${command.slice(1, -1)}`)
  let unmet = 0
  for (const [ident, command = '', expect = ''] of rows) {
    const bare = command.slice(1, -1)
    const result = run(bare, root, level)
    const ok = met(expect, result.code, result.out)
    if (!ok) unmet++
    let line = `  ${ok ? 'MET  ' : 'UNMET'} ${ident}. ${bare}  [${expect}]`
    const why = ok ? '' : detail(result.err)
    if (why) line += `  — ${why}`
    say(line)
  }
  if (unmet) {
    say(`CONVERGE: UNMET ${unmet} of ${rows.length}`)
    return UNMET
  }
  say(`CONVERGE: MET ${rows.length}/${rows.length}`)
  return MET
}

function git(root: string, ...args: string[]): string {
  const done = spawnSync('git', args, { cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER })
  return done.status === 0 ? (done.stdout ?? '') : ''
}

function report(root: string, contract: string): string[] {
  const text = readFileSync(contract, 'utf8').replace(/\r\n?/g, '\n')
  const name = contract.split('/').pop() ?? ''
  let slug = name.slice(0, name.lastIndexOf('.') > 0 ? name.lastIndexOf('.') : name.length)
  const title = splitLines(text).find((line) => line.startsWith('# '))
  if (title !== undefined) slug = strip(title.slice(2))
  const count = numberedRows(text).length
  if (!count) return []
  const out = [`wave ${slug} · ${count} criteria · run ds:converge for the verdict`]
  const relative = contract.startsWith(`${root}/`) ? contract.slice(root.length + 1) : contract
  const first = git(root, 'log', '--format=%H', '--reverse', '--', relative).split('\n')[0] ?? ''
  if (first) {
    const spent = strip(git(root, 'rev-list', '--count', `${first}..HEAD`))
    const wanted = /^\p{Nd}+/u.exec(field(text, 'budget'))
    if (spent && wanted) out.push(`  commits: ${spent} of ${wanted[0]}`)
    else if (spent) out.push(`  commits since contract: ${spent}`)
    const mix = layerMix(git(root, 'diff', '--numstat', `${first}..HEAD`))
    if (mix) out.push(mix)
  }
  return out
}

function payloadCwd(raw: string): string | undefined {
  try {
    const payload: unknown = raw.trim() ? JSON.parse(raw) : {}
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
    const cwd = (payload as Record<string, unknown>).cwd
    return typeof cwd === 'string' && cwd ? cwd : undefined
  } catch {
    return undefined
  }
}

export function convergenceStateVerb(): number {
  let raw = ''
  try {
    raw = readFileSync(0, 'utf8')
  } catch {
    return 0
  }
  const given = payloadCwd(raw)
  if (given === undefined || !isDir(given)) return 0
  const root = pyPath(given)
  const out: string[] = []
  for (const slug of liveSlugs(root)) {
    const contract = contractFor(root, slug)
    if (contract === undefined) {
      out.push(`wave ${slug} · no contract · ds:new writes one, ds:converge reads it`)
      continue
    }
    try {
      out.push(...report(root, contract))
    } catch {}
  }
  if (out.length) say(out.join('\n'))
  return 0
}
