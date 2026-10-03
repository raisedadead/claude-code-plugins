import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, normalize, relative, sep } from 'node:path'
import { test } from 'node:test'
import { shlexWords } from '../engine/converge.ts'

const ROOT = realpathSync(join(import.meta.dirname, '..', '..', '..'))
const PLUGINS = ['dossier', 'whetstone']
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

function exists(path: string): boolean {
  try {
    readFileSync(path)
    return true
  } catch {
    return false
  }
}

function withTree<T>(files: Record<string, string>, body: (root: string) => T): T {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'ds-manifest-')))
  try {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true })
      writeFileSync(join(root, path), text)
    }
    return body(root)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function marketProblems(root: string): string[] {
  const text = readFileSync(join(root, '.claude-plugin', 'marketplace.json'), 'utf8')
  const market = JSON.parse(text) as { plugins?: Record<string, unknown>[] }
  const out = /"whetstone"/.test(text) ? [] : ['the marketplace does not list whetstone']
  for (const plugin of market.plugins ?? []) if ('version' in plugin) out.push(`${String(plugin.name)} pins a version`)
  return out
}

function manifestProblems(root: string): string[] {
  const out: string[] = []
  for (const plugin of PLUGINS) {
    const path = join(root, 'plugins', plugin, '.claude-plugin', 'plugin.json')
    const text = readFileSync(path, 'utf8')
    if (text.includes(DEAD_SCHEMA)) out.push(`${plugin} declares a $schema URL that 404s`)
    if ('version' in (JSON.parse(text) as Record<string, unknown>)) out.push(`${plugin} carries a version key`)
  }
  return out
}

function linkProblems(root: string): string[] {
  const out: string[] = []
  for (const plugin of PLUGINS) {
    const home = join(root, 'plugins', plugin)
    for (const path of walk(home).filter((file) => file.endsWith('.md'))) {
      for (const match of readFileSync(path, 'utf8').matchAll(/\]\((\.[^)\s]*)\)/g)) {
        const target = (match[1] ?? '').split('#')[0]
        if (!target) continue
        const resolved = normalize(join(dirname(path), target))
        if (resolved !== home && !resolved.startsWith(home + sep)) out.push(`${relative(root, path)} -> ${match[1]}`)
      }
    }
  }
  return out
}

function idProblems(root: string): string[] {
  const out = new Set<string>()
  for (const plugin of PLUGINS) {
    for (const path of walk(join(root, 'plugins', plugin)).filter((file) => file.endsWith('.md') && !file.endsWith(`${sep}CHANGELOG.md`))) {
      for (const [, owner = '', id = ''] of readFileSync(path, 'utf8').matchAll(/\b(dossier|whetstone):([a-z][a-z0-9-]*)\b/g)) {
        const home = join(root, 'plugins', owner)
        if (!exists(join(home, 'skills', id, 'SKILL.md')) && !exists(join(home, 'agents', `${id}.md`))) {
          out.add(`${relative(root, path)} -> ${owner}:${id}`)
        }
      }
    }
  }
  return [...out].sort()
}

function verbProblems(body: string, usage: string): string[] {
  const lead = /^(\w+) verbs of `\$\{CLAUDE_PLUGIN_ROOT\}\/cli\/ds`/m.exec(body)
  if (!lead) return ["FORMAT.md carries no 'N verbs of ${CLAUDE_PLUGIN_ROOT}/cli/ds' sentence"]
  const stated = NUMBERS[(lead[1] ?? '').toLowerCase()]
  if (!stated) return [`the verb count is not a number word: ${lead[1]}`]
  const table: string[] = []
  for (const line of body.slice(lead.index + lead[0].length).split('\n')) {
    if (line.startsWith('|')) table.push(line)
    else if (table.length) break
  }
  const roster = [...new Set(table.flatMap((row) => /^\| `ds ([a-z0-9-]+)`/.exec(row)?.[1] ?? []))]
  const verbs = /usage: ds <([a-z0-9|-]+)>/.exec(usage)
  if (!verbs) return [`cli/ds printed no verb list: ${usage.trim()}`]
  const known = new Set((verbs[1] ?? '').split('|'))
  const out = roster.length === stated ? [] : [`the sentence says ${stated}, the table lists ${roster.join(', ')}`]
  for (const verb of roster) if (!known.has(verb)) out.push(`the table names a verb cli/ds does not dispatch: ${verb}`)
  return out
}

function grepProblems(root: string): string[] {
  const body = readFileSync(join(root, 'plugins', 'dossier', 'FORMAT.md'), 'utf8')
  const out: string[] = []
  for (const [, span = ''] of body.matchAll(/`([^`\n]+)`/g)) {
    const command = span.trim()
    if (!command.startsWith('grep ') || !command.includes('plugins/dossier/')) continue
    const argv = shlexWords(command)
    if (!argv?.length) {
      out.push(`${command} -> unparseable`)
      continue
    }
    const done = spawnSync(argv[0] ?? '', argv.slice(1), { cwd: root, encoding: 'utf8' })
    if (done.status !== 0) out.push(`${command} -> exit ${done.status} ${done.error?.message ?? (done.stderr?.trim().split('\n')[0] || '(no match)')}`)
  }
  return out
}

const GOOD_TREE: Record<string, string> = {
  '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'dossier' }, { name: 'whetstone' }] }),
  'plugins/dossier/.claude-plugin/plugin.json': JSON.stringify({ name: 'dossier' }),
  'plugins/whetstone/.claude-plugin/plugin.json': JSON.stringify({ name: 'whetstone' }),
  'plugins/dossier/skills/build/SKILL.md': 'see [format](../../FORMAT.md) and dossier:build\n',
  'plugins/dossier/FORMAT.md': 'run `grep -q needle plugins/dossier/FORMAT.md` to find the needle\n',
}

function broken(edits: Record<string, string>): Record<string, string> {
  return { ...GOOD_TREE, ...edits }
}

test('the marketplace lists whetstone and pins no version', () => {
  assert.deepEqual(marketProblems(ROOT), [])
  withTree(GOOD_TREE, (root) => assert.deepEqual(marketProblems(root), []))
  const pinned = broken({ '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'dossier', version: '1.0.0' }] }) })
  withTree(pinned, (root) => assert.deepEqual(marketProblems(root), ['the marketplace does not list whetstone', 'dossier pins a version']))
})

test('each plugin manifest has a live schema and no version key', () => {
  assert.deepEqual(manifestProblems(ROOT), [])
  withTree(GOOD_TREE, (root) => assert.deepEqual(manifestProblems(root), []))
  const bad = broken({ 'plugins/whetstone/.claude-plugin/plugin.json': JSON.stringify({ $schema: DEAD_SCHEMA, version: '1.0.0' }) })
  withTree(bad, (root) => assert.deepEqual(manifestProblems(root), ['whetstone declares a $schema URL that 404s', 'whetstone carries a version key']))
})

test('no shipped markdown link escapes its plugin root', () => {
  assert.deepEqual(linkProblems(ROOT), [])
  withTree(GOOD_TREE, (root) => assert.deepEqual(linkProblems(root), []))
  const escaping = broken({
    'plugins/dossier/skills/build/SKILL.md': 'see [readme](../../../../README.md) and [top](../../FORMAT.md#top)\n',
  })
  withTree(escaping, (root) => assert.deepEqual(linkProblems(root), ['plugins/dossier/skills/build/SKILL.md -> ../../../../README.md']))
})

test('every skill or agent id a shipped doc names exists', () => {
  assert.deepEqual(idProblems(ROOT), [])
  withTree(GOOD_TREE, (root) => assert.deepEqual(idProblems(root), []))
  const unknown = broken({
    'plugins/dossier/FORMAT.md': 'see dossier:nope, whetstone:gone and dossier:dossier-reviewer\n',
    'plugins/dossier/agents/dossier-reviewer.md': 'agent\n',
    'plugins/dossier/CHANGELOG.md': 'removed dossier:old\n',
  })
  withTree(unknown, (root) =>
    assert.deepEqual(idProblems(root), ['plugins/dossier/FORMAT.md -> dossier:nope', 'plugins/dossier/FORMAT.md -> whetstone:gone']),
  )
})

test("FORMAT.md's cli/ds verb count agrees with its roster table and the dispatcher", () => {
  const usage = spawnSync(join(ROOT, 'plugins', 'dossier', 'cli', 'ds'), { encoding: 'utf8' }).stderr ?? ''
  assert.deepEqual(verbProblems(readFileSync(join(ROOT, 'plugins', 'dossier', 'FORMAT.md'), 'utf8'), usage), [])
  const table = 'Two verbs of `${CLAUDE_PLUGIN_ROOT}/cli/ds` own it:\n\n| verb |\n| --- |\n| `ds a` |\n| `ds b` |\n'
  assert.deepEqual(verbProblems(table, 'usage: ds <a|b>'), [])
  assert.deepEqual(verbProblems(table.replace('Two', 'Three'), 'usage: ds <a|b>'), ['the sentence says 3, the table lists a, b'])
  assert.deepEqual(verbProblems(table, 'usage: ds <a>'), ['the table names a verb cli/ds does not dispatch: b'])
  assert.deepEqual(verbProblems('no sentence', 'usage: ds <a>'), ["FORMAT.md carries no 'N verbs of ${CLAUDE_PLUGIN_ROOT}/cli/ds' sentence"])
  assert.deepEqual(verbProblems(table.replace('Two', 'Many'), 'usage: ds <a|b>'), ['the verb count is not a number word: Many'])
  assert.deepEqual(verbProblems(table, ''), ['cli/ds printed no verb list: '])
})

test('every discovery grep written in FORMAT.md runs clean from the repo root', () => {
  assert.deepEqual(grepProblems(ROOT), [])
  withTree(GOOD_TREE, (root) => assert.deepEqual(grepProblems(root), []))
  const stale = broken({ 'plugins/dossier/FORMAT.md': 'run `grep -q absent plugins/dossier/skills/build/SKILL.md`, `grep -q x plugins/dossier/gone.md` and `grep -q "open plugins/dossier/x`\n' })
  withTree(stale, (root) =>
    assert.deepEqual(grepProblems(root), [
      'grep -q absent plugins/dossier/skills/build/SKILL.md -> exit 1 (no match)',
      'grep -q x plugins/dossier/gone.md -> exit 2 grep: plugins/dossier/gone.md: No such file or directory',
      'grep -q "open plugins/dossier/x -> unparseable',
    ]),
  )
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
