import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { buildArtifacts } from './build.ts'
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const temps: string[] = []
function temp() {
  const p = fs.mkdtempSync(path.join(fs.realpathSync(tmpdir()), 'assembler-'))
  temps.push(p)
  return p
}
function put(root: string, name: string, text: string) {
  const p = path.join(root, name)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}
function fixture() {
  const root = temp()
  put(root, 'hosts/pi/delegate.ts', 'export {}\n')
  for (const plugin of ['dossier', 'whetstone']) {
    put(
      root,
      `plugins/${plugin}/skills/demo/SKILL.md`,
      '---\nname: demo\ndescription: A useful demonstration.\ndisable-model-invocation: true\nargument-hint: "<value>"\nmetadata:\n  category: testing\n---\n# Demo\n',
    )
    put(root, `plugins/${plugin}/pi/index.ts`, "export { default } from '../../../hosts/pi/delegate.ts'\n")
    put(root, `plugins/${plugin}/.claude-plugin/plugin.json`, JSON.stringify({ name: plugin, description: 'Original' }))
  }
  return root
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const p of temps.splice(0)) fs.rmSync(p, { recursive: true, force: true })
})
describe('production assembler', () => {
  it('preserves native directories, metadata and independent package topology', () => {
    const root = fixture()
    fs.rmSync(path.join(root, 'plugins/whetstone'), { recursive: true })
    const output = path.join(root, 'pi')
    buildArtifacts({ root, output, plugins: ['dossier'] })
    const text = fs.readFileSync(path.join(output, 'plugins/dossier/skills/demo/SKILL.md'), 'utf8')
    expect(text).toContain('name: dossier-demo')
    expect(text).toContain('disable-model-invocation: true')
    expect(text).toContain('category: testing')
    const pkg = JSON.parse(fs.readFileSync(path.join(output, 'package.json'), 'utf8'))
    expect(pkg.pi.skills).toEqual(['./plugins/dossier/skills'])
    expect(pkg.pi.extensions).toEqual(['./plugins/dossier/pi/index.ts'])
    expect(pkg.dependencies).toBeUndefined()
    expect(fs.existsSync(path.join(output, 'hosts/pi/delegate.ts'))).toBe(true)
    expect(buildArtifacts({ root, output, plugins: ['dossier'], check: true }).files).toBeGreaterThan(3)
  })
  it('checks bytes, executable bits, missing and unexpected files without writing', () => {
    const root = fixture()
    const output = path.join(root, 'pi')
    buildArtifacts({ root })
    for (const mutation of ['bytes', 'mode', 'missing', 'extra']) {
      const p = path.join(output, 'package.json')
      const bytes = fs.readFileSync(p)
      if (mutation === 'bytes') fs.appendFileSync(p, ' ')
      if (mutation === 'mode') fs.chmodSync(p, 0o755)
      if (mutation === 'missing') fs.unlinkSync(p)
      if (mutation === 'extra') put(output, 'unexpected', 'x')
      expect(() => buildArtifacts({ root, check: true })).toThrow()
      fs.writeFileSync(p, bytes)
      fs.chmodSync(p, 0o644)
      fs.rmSync(path.join(output, 'unexpected'), { force: true })
    }
    expect(() => buildArtifacts({ root, check: true })).not.toThrow()
  })
  it.each(['name: other\ndescription: okay', 'name: demo\ndescription: []', 'name: demo\nname: demo\ndescription: okay', 'description: okay'])(
    'preflights invalid metadata: %s',
    (metadata) => {
      const root = fixture()
      put(root, 'plugins/dossier/skills/demo/SKILL.md', `---\n${metadata}\n---\nBody\n`)
      expect(() => buildArtifacts({ root })).toThrow()
      expect(fs.existsSync(path.join(root, 'pi'))).toBe(false)
    },
  )
  it('preflights resource references with quotes and punctuation', () => {
    const root = fixture()
    const p = 'plugins/dossier/skills/demo/SKILL.md'
    const original = fs.readFileSync(path.join(root, p), 'utf8')
    put(root, p, original + '\nRun `"${CLAUDE_PLUGIN_ROOT}"/bin/missing` (now).\n')
    expect(() => buildArtifacts({ root })).toThrow(/resource/i)
    put(root, 'plugins/dossier/bin/missing', '#!/bin/sh\nexit 0\n')
    fs.chmodSync(path.join(root, 'plugins/dossier/bin/missing'), 0o755)
    buildArtifacts({ root })
    expect(fs.statSync(path.join(root, 'pi/plugins/dossier/bin/missing')).mode & 0o111).toBe(0o111)
  })
  it('resolves ordinary output-parent aliases without confusing them with source overlap', () => {
    const root = fixture()
    const storage = temp()
    const aliases = temp()
    const alias = path.join(aliases, 'temp-alias')
    fs.symlinkSync(storage, alias)
    const output = path.join(alias, 'standalone')
    buildArtifacts({ root, output, plugins: ['dossier'] })
    expect(fs.existsSync(path.join(storage, 'standalone/package.json'))).toBe(true)
    expect(fs.existsSync(path.join(root, 'pi'))).toBe(false)
    expect(() => buildArtifacts({ root, output, plugins: ['dossier'], check: true })).not.toThrow()
  })

  it('rejects unsafe outputs, unowned outputs and source symlinks', () => {
    const root = fixture()
    for (const output of ['plugins/dossier/out', 'plugins/whetstone', 'hosts/out', 'tools/out', '.git/out', '.'])
      expect(() => buildArtifacts({ root, output })).toThrow()
    put(root, 'pi/foreign', 'keep')
    expect(() => buildArtifacts({ root })).toThrow(/owned/i)
    fs.rmSync(path.join(root, 'pi'), { recursive: true })
    fs.symlinkSync(path.join(root, 'plugins'), path.join(root, 'alias'))
    expect(() => buildArtifacts({ root, output: 'alias/out' })).toThrow()
    fs.symlinkSync('/etc/passwd', path.join(root, 'plugins/dossier/skills/demo/link'))
    expect(() => buildArtifacts({ root })).toThrow(/symlink/i)
  })
  it('preserves Claude manifests and hook registration byte for byte', () => {
    const root = fixture()
    put(root, 'plugins/dossier/hooks/register.ts', 'original\n')
    put(root, '.claude-plugin/marketplace.json', '{"name":"original"}\n')
    const output = path.join(temp(), 'claude-out')
    buildArtifacts({ root, output, target: 'claude' })
    expect(fs.readFileSync(path.join(output, 'plugins/dossier/.claude-plugin/plugin.json'))).toEqual(
      fs.readFileSync(path.join(root, 'plugins/dossier/.claude-plugin/plugin.json')),
    )
    expect(fs.readFileSync(path.join(output, 'plugins/dossier/hooks/register.ts'), 'utf8')).toBe('original\n')
    expect(fs.existsSync(path.join(output, '.claude-plugin/marketplace.json'))).toBe(true)
  })
  it('rolls back when staging rename fails', () => {
    const root = fixture()
    buildArtifacts({ root })
    const before = fs.readFileSync(path.join(root, 'pi/package.json'))
    const rename = fs.renameSync
    vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => {
      if (String(a).includes('.stage-') && !String(a).endsWith('.backup')) throw new Error('injected rename failure')
      return rename(a, b)
    })
    expect(() => buildArtifacts({ root })).toThrow('injected rename failure')
    expect(fs.readFileSync(path.join(root, 'pi/package.json'))).toEqual(before)
  })
  it('builds real plugins deterministically and loads relocated skills and extensions through the public SDK', async () => {
    const output = path.join(temp(), 'package')
    buildArtifacts({ root: repo, output })
    buildArtifacts({ root: repo, output, check: true })
    const sdk = await import('@earendil-works/pi-coding-agent')
    const agentDir = temp()
    const manager = new sdk.DefaultPackageManager({ cwd: output, agentDir, settingsManager: sdk.SettingsManager.inMemory() })
    const discovered = await manager.resolveExtensionSources([output], { temporary: true })
    expect(discovered.extensions.filter((p) => p.enabled)).toHaveLength(2)
    const loaded = sdk.loadSkills({ cwd: output, agentDir, skillPaths: discovered.skills.filter((p) => p.enabled).map((p) => p.path), includeDefaults: false })
    expect(loaded.skills.length).toBe(23)
    expect(loaded.diagnostics.filter((d) => d.type === 'error')).toEqual([])
    const extensions = await sdk.discoverAndLoadExtensions(
      discovered.extensions.filter((p) => p.enabled).map((p) => p.path),
      output,
      agentDir,
    )
    expect(extensions.errors).toEqual([])
    expect(extensions.extensions).toHaveLength(2)
    const script = path.join(output, 'plugins/dossier/cli/ds')
    expect(fs.statSync(script).mode & 0o111).not.toBe(0)
    const run = spawnSync(script, ['root'], { cwd: output, encoding: 'utf8' })
    expect(run.status).toBe(0)
  })
  it.each(['dossier', 'whetstone'] as const)('builds and loads real standalone %s with its sibling absent', async (plugin) => {
    const root = temp()
    fs.cpSync(path.join(repo, 'plugins', plugin), path.join(root, 'plugins', plugin), { recursive: true })
    fs.cpSync(path.join(repo, 'hosts'), path.join(root, 'hosts'), { recursive: true })
    const output = path.join(temp(), 'standalone')
    buildArtifacts({ root, output, plugins: [plugin] })
    expect(fs.existsSync(path.join(output, 'plugins', plugin === 'dossier' ? 'whetstone' : 'dossier'))).toBe(false)
    const sdk = await import('@earendil-works/pi-coding-agent')
    const loaded = await sdk.discoverAndLoadExtensions([path.join(output, 'plugins', plugin, 'pi/index.ts')], output, temp())
    expect(loaded.errors).toEqual([])
    expect(loaded.extensions).toHaveLength(1)
    expect(fs.existsSync(path.join(output, 'plugins', plugin, 'workflows'))).toBe(false)
    expect(fs.existsSync(path.join(output, 'plugins', plugin, 'hooks/register.ts'))).toBe(false)
  })
  it('preserves binary assets and rejects broken local links and unsupported tokens before touching output', () => {
    const root = fixture()
    const file = path.join(root, 'plugins/dossier/skills/demo/asset.bin')
    const bytes = Buffer.from([0, 255, 13, 10, 128])
    fs.writeFileSync(file, bytes)
    buildArtifacts({ root })
    expect(fs.readFileSync(path.join(root, 'pi/plugins/dossier/skills/demo/asset.bin'))).toEqual(bytes)
    const skill = path.join(root, 'plugins/dossier/skills/demo/SKILL.md')
    const original = fs.readFileSync(skill, 'utf8')
    for (const extra of ['[missing](reference/missing.md)', '{{UNSUPPORTED}}', '${CLAUDE_PLUGIN_ROOT}/../../escape']) {
      fs.writeFileSync(skill, original + '\n' + extra)
      expect(() => buildArtifacts({ root })).toThrow()
      expect(fs.readFileSync(path.join(root, 'pi/plugins/dossier/skills/demo/asset.bin'))).toEqual(bytes)
    }
  })
  it('does not trust a marker filename or a forged signature', () => {
    const root = fixture()
    for (const marker of ['{}', '{"assembler":"foreign","schema":1}', 'not json']) {
      put(root, 'pi/.build-artifacts.json', marker)
      expect(() => buildArtifacts({ root })).toThrow(/unowned/)
      expect(fs.readFileSync(path.join(root, 'pi/.build-artifacts.json'), 'utf8')).toBe(marker)
    }
  })
  it('rejects a generated output symlink even in check mode', () => {
    const root = fixture()
    const outside = temp()
    fs.symlinkSync(outside, path.join(root, 'pi'))
    expect(() => buildArtifacts({ root })).toThrow(/symlink/)
    expect(() => buildArtifacts({ root, check: true })).toThrow(/symlink/)
    expect(fs.readdirSync(outside)).toEqual([])
  })
  it('validates CLI flags without writing artifacts', () => {
    const script = path.join(repo, 'tools/build/build.ts')
    expect(spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' }).status).toBe(0)
    for (const flags of [['--unknown'], ['--target'], ['--target', 'bogus'], ['--plugin', 'bogus'], ['--out']]) {
      const run = spawnSync(process.execPath, [script, ...flags], { encoding: 'utf8' })
      expect(run.status).toBe(1)
      expect(run.stderr).toMatch(/Unknown|Missing|Invalid/)
    }
  })
})
