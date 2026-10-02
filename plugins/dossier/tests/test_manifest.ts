import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, relative, sep } from 'node:path'
import { test } from 'node:test'
import { shlexWords } from '../engine/converge.ts'

const ROOT = realpathSync(join(import.meta.dirname, '..', '..', '..'))
const PLUGINS = ['dossier', 'whetstone']
const MARKET = join(ROOT, '.claude-plugin', 'marketplace.json')
const MANIFESTS = PLUGINS.map((name) => join(ROOT, 'plugins', name, '.claude-plugin', 'plugin.json'))
const DEAD_SCHEMA = 'https://json.schemastore.org/claude-code-plugin.json'
const NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 }

function walk(dir: string): string[] {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries.flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]))
}

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

test('the marketplace is valid JSON, lists whetstone and pins no version', () => {
  const market = json(MARKET) as { plugins?: Record<string, unknown>[] }
  assert.match(readFileSync(MARKET, 'utf8'), /"whetstone"/)
  assert.deepEqual((market.plugins ?? []).filter((plugin) => 'version' in plugin), [], 'commit SHA is the version, RESEARCH.md D1')
})

test('each plugin manifest is valid JSON with a live schema and no version key', () => {
  for (const path of MANIFESTS) {
    const manifest = json(path) as Record<string, unknown>
    assert.ok(!readFileSync(path, 'utf8').includes(DEAD_SCHEMA), `${path} declares a $schema URL that 404s`)
    assert.ok(!('version' in manifest), `${path} carries a version key; commit SHA is the version, RESEARCH.md D1`)
  }
})

test('no shipped markdown link escapes its plugin root', () => {
  const bad: string[] = []
  for (const plugin of PLUGINS) {
    const root = join(ROOT, 'plugins', plugin)
    for (const path of walk(root).filter((file) => file.endsWith('.md'))) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\]\((\.[^)\s]*)\)/g)) {
        const target = (match[1] ?? '').split('#')[0]
        if (!target) continue
        const resolved = normalize(join(dirname(path), target))
        if (resolved !== root && !resolved.startsWith(root + sep)) bad.push(`${relative(ROOT, path)} -> ${match[1]}`)
      }
    }
  }
  assert.deepEqual(bad, [])
})

test('every skill or agent id a shipped doc names exists', () => {
  const bad = new Set<string>()
  for (const plugin of PLUGINS) {
    for (const path of walk(join(ROOT, 'plugins', plugin)).filter((file) => file.endsWith('.md') && !file.endsWith(`${sep}CHANGELOG.md`))) {
      for (const [, owner = '', id = ''] of readFileSync(path, 'utf8').matchAll(/\b(dossier|whetstone):([a-z][a-z0-9-]*)\b/g)) {
        const home = join(ROOT, 'plugins', owner)
        if (!exists(join(home, 'skills', id, 'SKILL.md')) && !exists(join(home, 'agents', `${id}.md`))) {
          bad.add(`${relative(ROOT, path)} -> ${owner}:${id}`)
        }
      }
    }
  }
  assert.deepEqual([...bad].sort(), [])
})

test("FORMAT.md's cli/ds verb count agrees with its roster table and the dispatcher", () => {
  const body = readFileSync(join(ROOT, 'plugins', 'dossier', 'FORMAT.md'), 'utf8')
  const lead = /^(\w+) verbs of `\$\{CLAUDE_PLUGIN_ROOT\}\/cli\/ds`/m.exec(body)
  assert.ok(lead, "FORMAT.md carries no 'N verbs of ${CLAUDE_PLUGIN_ROOT}/cli/ds' sentence")
  const stated = NUMBERS[(lead[1] ?? '').toLowerCase()]
  assert.ok(stated, `the verb count is not a number word: ${lead[1]}`)
  const table: string[] = []
  for (const line of body.slice(lead.index + lead[0].length).split('\n')) {
    if (line.startsWith('|')) table.push(line)
    else if (table.length) break
  }
  const roster = [...new Set(table.flatMap((row) => /^\| `ds ([a-z0-9-]+)`/.exec(row)?.[1] ?? []))]
  const usage = spawnSync(join(ROOT, 'plugins', 'dossier', 'cli', 'ds'), { encoding: 'utf8' }).stderr ?? ''
  const verbs = /usage: ds <([a-z0-9|-]+)>/.exec(usage)
  assert.ok(verbs, `cli/ds printed no verb list: ${usage.trim()}`)
  const known = new Set((verbs[1] ?? '').split('|'))
  assert.equal(roster.length, stated, `the sentence says ${stated}, the table lists ${roster.join(', ')}`)
  assert.deepEqual(roster.filter((verb) => !known.has(verb)), [], 'the table names a verb cli/ds does not dispatch')
})

test('every discovery grep written in FORMAT.md runs clean from the repo root', () => {
  const body = readFileSync(join(ROOT, 'plugins', 'dossier', 'FORMAT.md'), 'utf8')
  const bad: string[] = []
  for (const [, span = ''] of body.matchAll(/`([^`\n]+)`/g)) {
    const command = span.trim()
    if (!command.startsWith('grep ') || !command.includes('plugins/dossier/')) continue
    const argv = shlexWords(command)
    if (!argv?.length) {
      bad.push(`${command} -> unparseable`)
      continue
    }
    const done = spawnSync(argv[0] ?? '', argv.slice(1), { cwd: ROOT, encoding: 'utf8' })
    if (done.status !== 0) bad.push(`${command} -> exit ${done.status} ${done.error?.message ?? (done.stderr?.trim().split('\n')[0] || '(no match)')}`)
  }
  assert.deepEqual(bad, [])
})

const BARE = /\$CLAUDE_PLUGIN_(ROOT|DATA)\b/
const REPO_PATH = /(?<![\w/.-])(?:\.\/)?plugins\/(dossier|whetstone)\//

function offences(pluginsDir: string): string[] {
  const out: string[] = []
  for (const plugin of readdirSync(pluginsDir).sort()) {
    for (const kind of ['skills', 'agents']) {
      for (const path of walk(join(pluginsDir, plugin, kind))) {
        const name = path.split(sep).pop() ?? ''
        if ((kind === 'skills' && name !== 'SKILL.md') || !name.endsWith('.md')) continue
        readFileSync(path, 'utf8')
          .split('\n')
          .forEach((line, at) => {
            if (BARE.test(line) || REPO_PATH.test(line)) out.push(`${relative(pluginsDir, path)}:${at + 1}`)
          })
      }
    }
  }
  return out
}

function fixture(line: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), 'ds-manifest-'))
  try {
    mkdirSync(join(dir, 'p', 'skills', 's'), { recursive: true })
    writeFileSync(join(dir, 'p', 'skills', 's', 'SKILL.md'), `${line}\n`)
    return offences(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the install-path rule catches the bare and repo-relative forms and passes the braced one', () => {
  assert.ok(fixture('run "$CLAUDE_PLUGIN_ROOT"/hooks/x.sh').length)
  assert.ok(fixture('read plugins/dossier/FORMAT.md').length)
  assert.ok(fixture('read ./plugins/dossier/FORMAT.md').length)
  assert.deepEqual(fixture('run "${CLAUDE_PLUGIN_ROOT}"/hooks/x.sh'), [])
})

test('no skill or agent body reaches a bundled file by a path that is empty or absent at install', () => {
  assert.deepEqual(offences(join(ROOT, 'plugins')), [])
})
