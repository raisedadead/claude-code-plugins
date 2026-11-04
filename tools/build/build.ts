import fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseDocument, isMap } from 'yaml'
import { transformMarkdown } from '../../hosts/pi/content.ts'

type Plugin = 'dossier' | 'whetstone'
type Target = 'pi' | 'claude'
export type BuildOptions = { root?: string; output?: string; target?: Target; plugins?: Plugin[]; check?: boolean }
type Artifact = { bytes: Buffer; mode: number }
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const PLUGINS: Plugin[] = ['dossier', 'whetstone']
const MARKER = '.build-artifacts.json'
const SIGNATURE = { assembler: 'claude-code-plugins/tools/build', schema: 1 }
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const within = (base: string, child: string) => child === base || child.startsWith(base.endsWith(path.sep) ? base : base + path.sep)
const json = (value: unknown) => JSON.stringify(value, null, 2) + '\n'
const excluded = new Set([
  'node_modules',
  'tests',
  'test',
  '__tests__',
  'evals',
  '.git',
  '.cache',
  '__pycache__',
  '.pytest_cache',
  'coverage',
  'dist',
  'generated',
  '.DS_Store',
])
const runtime = new Set(['skills', 'agents', 'cli', 'engine', 'bin', 'types', 'pi', 'hooks'])

function physical(p: string): string {
  let ancestor = p
  const suffix: string[] = []
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor)
    if (parent === ancestor) throw new Error(`Cannot resolve path: ${p}`)
    suffix.unshift(path.basename(ancestor))
    ancestor = parent
  }
  return path.resolve(fs.realpathSync(ancestor), ...suffix)
}
function assertNoSymlinks(p: string, boundary: string) {
  let current = p
  while (within(boundary, current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error(`Input/output symlink refused: ${current}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    if (current === boundary) break
    current = path.dirname(current)
  }
}
function walk(base: string, select: (relative: string, directory: boolean) => boolean = () => true): string[] {
  const files: string[] = []
  function visit(dir: string, relative: string) {
    for (const name of fs.readdirSync(dir).sort(compare)) {
      const p = path.join(dir, name)
      const rel = relative ? `${relative}/${name}` : name
      const stat = fs.lstatSync(p)
      if (stat.isSymbolicLink()) throw new Error(`Input symlink refused: ${p}`)
      if (!select(rel, stat.isDirectory())) continue
      if (stat.isDirectory()) visit(p, rel)
      else if (stat.isFile()) files.push(rel)
      else throw new Error(`Unsupported file type: ${p}`)
    }
  }
  assertNoSymlinks(base, path.parse(base).root)
  visit(base, '')
  return files.sort(compare)
}
function selected(relative: string, directory: boolean, target: Target): boolean {
  const parts = relative.split('/')
  if (parts.some((p) => excluded.has(p)) || /(?:\.pyc|\.tsbuildinfo)$/.test(relative)) return false
  if (target === 'claude') return parts[0] !== 'pi'
  if (parts[0] === 'workflows' || parts[0] === '.claude-plugin') return false
  if (parts[0] === 'hooks' && /(?:^|\/)(?:register\.tsx?|hooks\.json)$/.test(relative)) return false
  if (parts.length === 1 && !directory) return /\.(?:md|txt)$/i.test(relative) || /^(?:LICENSE|NOTICE)(?:\..*)?$/.test(relative)
  return runtime.has(parts[0])
}
function frontmatter(text: string, label: string, required = false) {
  const match = /^(?:\uFEFF)?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)
  if (!match) {
    if (required) throw new Error(`Missing skill metadata: ${label}`)
    return undefined
  }
  const doc = parseDocument(match[1], { uniqueKeys: true, strict: true })
  if (doc.errors.length || !isMap(doc.contents)) throw new Error(`Invalid YAML metadata: ${label}: ${doc.errors.map((e) => e.message).join('; ')}`)
  return { doc, prefix: match[0], body: text.slice(match[0].length) }
}
function validateResources(text: string, base: string, relative: string, available: Set<string>) {
  const token = '${CLAUDE_PLUGIN_ROOT}'
  let offset = 0
  while ((offset = text.indexOf(token, offset)) >= 0) {
    const tail = text.slice(offset + token.length)
    const match = /^(?:["'])?\/([^\s`"'<>[\]{}|\\)]+?)(?=[\s`"'<>[\]{}|\\)]|$)/.exec(tail)
    offset += token.length
    if (!match) {
      if (/^["']?\//.test(tail)) throw new Error(`Unsupported resource reference: ${relative}`)
      continue
    }
    const ref = match[1].replace(/[.,;:!?]+$/, '').split('#')[0]
    const resolved = path.resolve(base, ref)
    if (!within(base, resolved)) throw new Error(`Escaping resource reference: ${relative}: ${ref}`)
    assertNoSymlinks(resolved, base)
    const normalized = path.relative(base, resolved).split(path.sep).join('/')
    if (!available.has(normalized) && ![...available].some((p) => p.startsWith(normalized + '/'))) throw new Error(`Missing resource: ${relative}: ${ref}`)
  }
  const prose = text.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*(?:\n|$)/gm, '')
  for (const match of prose.matchAll(/!?\[[^\]\n]*\]\(([^\s)]+)(?:\s+["'][^\n]*["'])?\)/g)) {
    const ref = match[1]
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#|\$|<)/i.test(ref) || /[{}<>]/.test(ref)) continue
    let decoded: string
    try {
      decoded = decodeURIComponent(ref.split('#')[0])
    } catch {
      throw new Error(`Invalid resource URL: ${relative}`)
    }
    if (!decoded || !/\.(?:md|png|jpg|svg|json|sh|ts)$/i.test(decoded)) continue
    const resolved = path.resolve(base, path.dirname(relative), decoded)
    if (!within(base, resolved)) throw new Error(`Escaping local resource: ${relative}: ${ref}`)
    const normalized = path.relative(base, resolved).split(path.sep).join('/')
    if (!available.has(normalized)) throw new Error(`Missing local resource: ${relative}: ${ref}`)
  }
}
function verifyOutputSafety(root: string, output: string) {
  assertNoSymlinks(output, output)
  const real = physical(output)
  const protectedPaths = ['plugins', 'hosts', 'tools', '.git'].map((p) => physical(path.join(root, p)))
  if (within(real, root) || protectedPaths.some((p) => within(p, real) || within(real, p))) throw new Error(`Unsafe output overlap: ${output}`)
  if (within(root, real) && real !== path.join(root, 'pi')) throw new Error(`Unsafe generated subtree: ${output}`)
}
function owned(output: string) {
  try {
    const p = path.join(output, MARKER)
    if (!fs.lstatSync(p).isFile()) return false
    const value = JSON.parse(fs.readFileSync(p, 'utf8'))
    return (
      value.assembler === SIGNATURE.assembler &&
      value.schema === SIGNATURE.schema &&
      (value.target === 'pi' || value.target === 'claude') &&
      Array.isArray(value.plugins) &&
      value.plugins.length > 0 &&
      value.plugins.every((p: string) => PLUGINS.includes(p as Plugin)) &&
      Object.keys(value).sort().join(',') === 'assembler,plugins,schema,target'
    )
  } catch {
    return false
  }
}
export function buildArtifacts(options: BuildOptions = {}): { files: number; output: string; target: Target } {
  const requestedRoot = path.resolve(options.root ?? ROOT)
  assertNoSymlinks(requestedRoot, path.parse(requestedRoot).root)
  const root = fs.realpathSync(requestedRoot)
  const target = options.target ?? 'pi'
  if (target !== 'pi' && target !== 'claude') throw new Error(`Invalid target: ${target}`)
  const plugins = [...new Set(options.plugins ?? PLUGINS)].sort(compare)
  if (!plugins.length || plugins.some((p) => !PLUGINS.includes(p))) throw new Error('Invalid plugin selection')
  const output = path.resolve(root, options.output ?? 'pi')
  verifyOutputSafety(root, output)
  if (!options.check && fs.existsSync(output) && !owned(output)) throw new Error(`Refusing unowned output: ${output}`)
  const artifacts = new Map<string, Artifact>()
  function add(name: string, bytes: string | Buffer, mode = 0o644) {
    if (artifacts.has(name)) throw new Error(`Duplicate artifact: ${name}`)
    artifacts.set(name, { bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes), mode })
  }
  function copy(source: string, destination: string) {
    assertNoSymlinks(source, root)
    const stat = fs.statSync(source)
    if (!stat.isFile()) throw new Error(`Not a regular source file: ${source}`)
    add(destination, fs.readFileSync(source), 0o644 | (stat.mode & 0o111))
  }
  const inventories = new Map<Plugin, string[]>()
  const skillNames = new Map<string, string>()
  for (const plugin of plugins) {
    const base = path.join(root, 'plugins', plugin)
    const files = walk(base, (rel, dir) => selected(rel, dir, target))
    inventories.set(plugin, files)
    if (target !== 'pi') continue
    const seen = new Set<string>()
    for (const file of files.filter((p) => /(?:^|\/)SKILL\.md$/.test(p))) {
      if (!/^skills\/[^/]+\/SKILL\.md$/.test(file)) throw new Error(`Unsupported nested skill: ${plugin}/${file}`)
      const meta = frontmatter(fs.readFileSync(path.join(base, file), 'utf8'), `${plugin}/${file}`, true)!
      const name = meta.doc.get('name')
      const description = meta.doc.get('description')
      if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64 || name !== file.split('/')[1] || seen.has(name))
        throw new Error(`Invalid or duplicate skill name: ${plugin}/${file}`)
      if (typeof description !== 'string' || !description.trim()) throw new Error(`Invalid skill description: ${plugin}/${file}`)
      const invocation = meta.doc.get('disable-model-invocation')
      if (invocation !== undefined && typeof invocation !== 'boolean') throw new Error(`Invalid invocation flag: ${plugin}/${file}`)
      seen.add(name)
      for (const prefix of plugin === 'dossier' ? ['dossier', 'ds'] : ['whetstone']) skillNames.set(`${prefix}:${name}`, `${plugin}-${name}`)
    }
    const skillDir = path.join(base, 'skills')
    if (fs.existsSync(skillDir))
      for (const entry of fs.readdirSync(skillDir, { withFileTypes: true })) {
        if (entry.isDirectory() && !excluded.has(entry.name) && !files.includes(`skills/${entry.name}/SKILL.md`))
          throw new Error(`Missing SKILL.md: ${plugin}/${entry.name}`)
      }
  }
  for (const plugin of plugins) {
    const base = path.join(root, 'plugins', plugin)
    const files = inventories.get(plugin)!
    for (const file of files) {
      const destination = `plugins/${plugin}/${file}`
      if (target !== 'pi' || !/\.md$/i.test(file)) {
        copy(path.join(base, file), destination)
        continue
      }
      const original = fs.readFileSync(path.join(base, file), 'utf8')
      validateResources(original, base, file, new Set(files))
      const before = frontmatter(original, destination)
      let transformed = transformMarkdown(original, { plugin, path: file, skills: skillNames })
      if (typeof transformed !== 'string') throw new Error(`Transformer returned non-text: ${destination}`)
      const after = frontmatter(transformed, destination)
      if (before?.prefix !== after?.prefix) throw new Error(`Transformer altered frontmatter: ${destination}`)
      if (/^skills\/[^/]+\/SKILL\.md$/.test(file)) {
        const meta = after!
        meta.doc.set('name', `${plugin}-${meta.doc.get('name')}`)
        transformed = `---\n${meta.doc.toString({ lineWidth: 0 })}---\n${meta.body}`
      }
      if (/\$\{CLAUDE_[A-Z_]+\}|\{\{[A-Z_]+\}\}/.test(transformed)) throw new Error(`Unsupported leftover template token: ${destination}`)
      add(destination, transformed, 0o644 | (fs.statSync(path.join(base, file)).mode & 0o111))
    }
  }
  if (target === 'pi') {
    copy(path.join(root, 'hosts/pi/delegate.ts'), 'hosts/pi/delegate.ts')
    add(
      'package.json',
      json({
        name: plugins.length === 1 ? `@claude-code-plugins/${plugins[0]}-pi` : '@claude-code-plugins/pi',
        private: true,
        type: 'module',
        pi: { extensions: plugins.map((p) => `./plugins/${p}/pi/index.ts`), skills: plugins.map((p) => `./plugins/${p}/skills`) },
        peerDependencies: { '@earendil-works/pi-coding-agent': '*', typebox: '*' },
      }),
    )
  } else if (plugins.length === 2 && fs.existsSync(path.join(root, '.claude-plugin'))) {
    for (const file of walk(path.join(root, '.claude-plugin'))) copy(path.join(root, '.claude-plugin', file), `.claude-plugin/${file}`)
  }
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) if (fs.existsSync(path.join(root, name))) copy(path.join(root, name), name)
  add(MARKER, json({ ...SIGNATURE, target, plugins }))
  const names = [...artifacts.keys()].sort(compare)
  if (options.check) {
    if (!fs.existsSync(output)) throw new Error(`Missing output: ${output}`)
    const actual = walk(physical(output))
    if (actual.join('\n') !== names.join('\n')) throw new Error(`Missing/stale/unexpected output files: ${output}`)
    for (const name of names) {
      const p = path.join(output, name)
      const expected = artifacts.get(name)!
      if (!fs.readFileSync(p).equals(expected.bytes) || (fs.statSync(p).mode & 0o111) !== (expected.mode & 0o111))
        throw new Error(`Stale output bytes or executable bits: ${name}`)
    }
  } else {
    fs.mkdirSync(path.dirname(output), { recursive: true })
    const staging = fs.mkdtempSync(path.join(path.dirname(output), `.${path.basename(output)}.stage-`))
    const backup = `${staging}.backup`
    let backedUp = false
    try {
      for (const name of names) {
        const p = path.join(staging, name)
        const artifact = artifacts.get(name)!
        fs.mkdirSync(path.dirname(p), { recursive: true })
        fs.writeFileSync(p, artifact.bytes)
        fs.chmodSync(p, artifact.mode)
      }
      if (fs.existsSync(output)) {
        fs.renameSync(output, backup)
        backedUp = true
      }
      try {
        fs.renameSync(staging, output)
      } catch (error) {
        if (backedUp) {
          fs.renameSync(backup, output)
          backedUp = false
        }
        throw error
      }
      if (backedUp) fs.rmSync(backup, { recursive: true, force: true })
    } finally {
      fs.rmSync(staging, { recursive: true, force: true })
    }
  }
  return { files: names.length, output, target }
}
function main(args: string[]) {
  const options: BuildOptions = {}
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    if (flag === '--help') {
      console.log('Usage: node tools/build/build.ts [--target pi|claude] [--out PATH] [--plugin dossier|whetstone]... [--check]')
      return
    }
    if (flag === '--check') {
      options.check = true
      continue
    }
    if (!['--target', '--out', '--plugin'].includes(flag)) throw new Error(`Unknown flag: ${flag}`)
    const value = args[++i]
    if (!value || value.startsWith('--')) throw new Error(`Missing value: ${flag}`)
    if (flag === '--target') {
      if (value !== 'pi' && value !== 'claude') throw new Error(`Invalid target: ${value}`)
      options.target = value
    }
    if (flag === '--out') options.output = value
    if (flag === '--plugin') {
      if (!PLUGINS.includes(value as Plugin)) throw new Error(`Invalid plugin: ${value}`)
      ;(options.plugins ??= []).push(value as Plugin)
    }
  }
  const result = buildArtifacts(options)
  console.log(`${options.check ? 'Checked' : 'Built'} ${result.files} files (${result.target})`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error((error as Error).message)
    process.exitCode = 1
  }
}
