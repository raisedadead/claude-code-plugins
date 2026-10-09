import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'vitest'
import { cachedLookup } from '../cli/verify.ts'
import { compilePython } from '../engine/pyregex.ts'
import {
  checkActionSha,
  checkEol,
  checkFreetext,
  checkImageTag,
  checkPkgOutdated,
  GO_MAJOR_PROBE_MAX,
  latestVersion,
  latestVersionDetail,
  type Lookup,
  patterns,
  resolvePin,
  type Rule,
  scan,
} from '../engine/verify.ts'

const DS = join(import.meta.dirname, '..', 'cli', 'ds')

const offline: Lookup = async () => ({ status: 'offline', data: null })

function payload(data: unknown): Lookup {
  return async () => ({ status: 'ok', data })
}

function withDir<T>(body: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'ds-verify-'))
  try {
    return body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

async function withDirAsync(body: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'ds-verify-'))
  try {
    await body(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function fakeProxy(versions: Record<string, string>, unanswered: string[] = []) {
  const asked: string[] = []
  const lookup: Lookup = async (url) => {
    const module = url.replace('https://proxy.golang.org/', '').replace(/\/@latest$/, '')
    asked.push(module)
    if (unanswered.includes(module)) return { status: 'offline', data: null }
    const version = versions[module]
    return version ? { status: 'ok', data: { Version: version } } : { status: 'missing', data: null }
  }
  return { asked, lookup }
}

const probe: Rule = {
  name: 'probe-freshness',
  pattern: 'PROBE-([A-Z0-9]+)',
  args: [1],
  check: (token) => [`probe ${token}`, 'superseded', 'https://example.invalid'],
  icon: '!',
  scope: 'all',
}

async function claims(content: string, path = 'app.py', rules = [probe]): Promise<string[]> {
  return (await scan(content, path, rules)).map((hit) => hit.finding[0])
}

function ds(args: string[], cwd: string, input = '', env: NodeJS.ProcessEnv = {}) {
  return spawnSync('sh', [DS, ...args], { cwd, input, encoding: 'utf8', env: { ...process.env, ...env } })
}

function seedCache(root: string, url: string, data: unknown): void {
  const dir = join(root, '.scratchpad', '.verify-cache')
  mkdirSync(dir, { recursive: true })
  const key = createHash('sha1').update(url).digest('hex')
  writeFileSync(join(dir, `${key}.json`), JSON.stringify({ fetched_at: 9e9, data }))
}

async function serve(code: number, body: (dir: string, url: string, hits: () => number) => Promise<void>): Promise<void> {
  let hits = 0
  const server = createServer((_request, response) => {
    hits++
    response.writeHead(code, { 'Content-Type': 'application/json' })
    response.end('{}')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  try {
    await withDirAsync((dir) => body(dir, `http://127.0.0.1:${port}/x.json`, () => hits))
  } finally {
    server.close()
  }
}

test('every registered rule compiles', () => {
  const rules = patterns(offline)
  assert.ok(rules.length > 0)
  for (const rule of rules) assert.ok(compilePython(rule.pattern), rule.name)
})

test('the checks answer nothing offline, except the unpinned action', async () => {
  assert.equal(await checkEol(offline, 'nodejs', '18'), undefined)
  assert.equal(await checkFreetext(offline, 'Node', '18'), undefined)
  assert.equal(await checkPkgOutdated(offline, 'npm', 'react', '16.0.0'), undefined)
  assert.equal(await checkImageTag(offline, 'node', '18-alpine'), undefined)
  assert.ok(await checkActionSha(offline, 'actions/checkout', 'v4'))
})

test('resolvePin marks an offline answer and refuses a bad spec', async () => {
  assert.equal((await resolvePin(offline, 'npm:react')).offline, true)
  assert.equal((await resolvePin(offline, 'eol:go')).offline, true)
  assert.ok('error' in (await resolvePin(offline, 'nocolonspec')))
})

test('a free-text claim on an EOL release fires', async () => {
  const releases = [
    { name: '24', isEol: false },
    { name: '18', isEol: true, eolFrom: '2025-04-30' },
  ]
  const finding = await checkFreetext(payload({ result: { releases } }), 'Node', '18')
  assert.deepEqual(finding, ['Node 18', 'current: nodejs 24. v18 EOL 2025-04-30.', 'https://endoflife.date/api/v1/products/nodejs'])
})

test('crates answers the highest stable, not the newest publish', async () => {
  const result = await latestVersion(payload({ crate: { newest_version: '0.8.8', max_stable_version: '0.10.2' } }), 'crates', 'rand')
  assert.equal(result?.[0], '0.10.2')
})

test('crates falls back when no stable release exists', async () => {
  const result = await latestVersion(payload({ crate: { newest_version: '1.0.0-alpha.4', max_stable_version: null } }), 'crates', 'x')
  assert.equal(result?.[0], '1.0.0-alpha.4')
})

test('hex answers the latest stable release', async () => {
  const result = await latestVersion(payload({ latest_stable_version: '1.4.5', releases: [{ version: '1.5.0-alpha.2' }] }), 'hex', 'jason')
  assert.equal(result?.[0], '1.4.5')
})

test('hex falls back when only pre-releases exist', async () => {
  const result = await latestVersion(payload({ releases: [{ version: '0.1.0-rc.1' }] }), 'hex', 'fresh')
  assert.equal(result?.[0], '0.1.0-rc.1')
})

test('the go walk finds a higher major', async () => {
  const proxy = fakeProxy({ 'm/chezmoi': 'v1.8.11', 'm/chezmoi/v2': 'v2.72.0' })
  const result = await latestVersionDetail(proxy.lookup, 'go', 'm/chezmoi')
  assert.equal(result?.[0], 'v2.72.0')
  assert.ok(result?.[1].endsWith('/m/chezmoi/v2/@latest'))
  assert.equal(result?.[2], undefined)
})

test('the go walk crosses a missing major', async () => {
  const proxy = fakeProxy({ 'm/lib': 'v1.0.0', 'm/lib/v3': 'v3.1.0' })
  assert.equal((await latestVersionDetail(proxy.lookup, 'go', 'm/lib'))?.[0], 'v3.1.0')
})

test('the go walk warns on an unanswered probe', async () => {
  const proxy = fakeProxy({ 'm/lib': 'v1.0.0', 'm/lib/v2': 'v2.0.0' }, ['m/lib/v5'])
  const result = await latestVersionDetail(proxy.lookup, 'go', 'm/lib')
  assert.equal(result?.[0], 'v2.0.0')
  assert.match(result?.[2] ?? '', /\/v5/)
})

test('the go walk warns at the probe ceiling', async () => {
  const versions: Record<string, string> = { 'm/big': 'v1.0.0' }
  for (let major = 2; major <= GO_MAJOR_PROBE_MAX; major++) versions[`m/big/v${major}`] = `v${major}.0.0`
  const result = await latestVersionDetail(fakeProxy(versions).lookup, 'go', 'm/big')
  assert.equal(result?.[0], `v${GO_MAJOR_PROBE_MAX}.0.0`)
  assert.match(result?.[2] ?? '', new RegExp(`/v${GO_MAJOR_PROBE_MAX}`))
})

test('a go path that names its major is answered as asked', async () => {
  const proxy = fakeProxy({ 'm/lib/v2': 'v2.9.0', 'm/lib/v3': 'v3.0.0' })
  assert.equal((await latestVersionDetail(proxy.lookup, 'go', 'm/lib/v2'))?.[0], 'v2.9.0')
  assert.deepEqual(proxy.asked, ['m/lib/v2'])
})

test('the reactive go check does not walk', async () => {
  const proxy = fakeProxy({ 'm/lib': 'v1.0.0', 'm/lib/v2': 'v2.0.0' })
  assert.equal((await latestVersion(proxy.lookup, 'go', 'm/lib'))?.[0], 'v1.0.0')
  assert.deepEqual(proxy.asked, ['m/lib'])
})

test('an unreachable go proxy resolves to nothing and starts no walk', async () => {
  const proxy = fakeProxy({}, ['m/lib'])
  assert.equal(await latestVersionDetail(proxy.lookup, 'go', 'm/lib'), undefined)
  assert.deepEqual(proxy.asked, ['m/lib'])
})

test('scan reports a matching rule and stays silent on benign content', async () => {
  assert.deepEqual(await claims("x = 'PROBE-ABC'\n"), ['probe ABC'])
  assert.deepEqual(await claims('x = 1\n'), [])
})

test('scan collapses a repeat and keeps distinct findings', async () => {
  assert.deepEqual(await claims("a = 'PROBE-ABC'\nb = 'PROBE-ABC'\nc = 'PROBE-ABC'\n"), ['probe ABC'])
  assert.deepEqual(await claims("a = 'PROBE-ABC'\nb = 'PROBE-XYZ'\n"), ['probe ABC', 'probe XYZ'])
})

test('a verify-skip marker drops its rule wherever it sits', async () => {
  assert.deepEqual(await claims("x = 'PROBE-ABC'  # verify-skip: probe-freshness\n"), [])
  assert.deepEqual(await claims("x = 'PROBE-ABC'\n# verify-skip: probe-freshness\ny = 'PROBE-ABC'\n"), [])
})

test('a yaml-scoped rule skips a python file', async () => {
  const yamlOnly: Rule = { ...probe, scope: 'yaml' }
  assert.deepEqual(await claims("x = 'PROBE-ABC'\n", 'app.py', [yamlOnly]), [])
  assert.deepEqual(await claims('x: PROBE-ABC\n', 'app.yaml', [yamlOnly]), ['probe ABC'])
})

test('cache-only mode answers offline without a request', async () => {
  await serve(200, async (dir, url, hits) => {
    assert.deepEqual(await cachedLookup(dir, true)(url), { status: 'offline', data: null })
    assert.equal(hits(), 0)
  })
})

test('a 404 is missing and is cached', async () => {
  await serve(404, async (dir, url, hits) => {
    const lookup = cachedLookup(dir, false)
    assert.deepEqual(await lookup(url), { status: 'missing', data: null })
    assert.deepEqual(await lookup(url), { status: 'missing', data: null })
    assert.equal(hits(), 1)
  })
})

test('a 500 is offline and is not cached', async () => {
  await serve(500, async (dir, url, hits) => {
    const lookup = cachedLookup(dir, false)
    assert.deepEqual(await lookup(url, { quiet: true }), { status: 'offline', data: null })
    assert.deepEqual(await lookup(url, { quiet: true }), { status: 'offline', data: null })
    assert.equal(hits(), 2)
  })
})

test('a cached miss replays as missing in cache-only mode', async () => {
  await withDirAsync(async (dir) => {
    seedCache(dir, 'https://example.invalid/miss.json', null)
    assert.deepEqual(await cachedLookup(dir, true)('https://example.invalid/miss.json'), { status: 'missing', data: null })
  })
})

test('verify-sweep reports a stale claim on disk', () => {
  withDir((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    const file = join(dir, '.github', 'workflows', 'ci.yml')
    writeFileSync(file, 'steps:\n  - uses: actions/checkout@v4\n  - uses: actions/checkout@v4\n')
    const done = ds(['verify-sweep', file], dir, '', { DOSSIER_VERIFY_CACHE_ONLY: '1' })
    assert.equal(done.status, 0)
    assert.equal(
      done.stdout,
      `${file}:github_action_unpinned: uses: actions/checkout@v4 -> resolve: gh api repos/actions/checkout/git/refs/tags/v4  [src: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions]\n`,
    )
  })
})

test('verify-sweep stays silent on benign, skipped and missing files', () => {
  withDir((dir) => {
    mkdirSync(join(dir, '.github', 'workflows'), { recursive: true })
    const benign = join(dir, '.github', 'workflows', 'a.yml')
    const skipped = join(dir, '.github', 'workflows', 'b.yml')
    writeFileSync(benign, 'steps:\n  - run: true\n')
    writeFileSync(skipped, '- uses: actions/checkout@v4\n# verify-skip: github_action_unpinned\n')
    const done = ds(['verify-sweep', benign, skipped, join(dir, 'absent.yml')], dir, '', { DOSSIER_VERIFY_CACHE_ONLY: '1' })
    assert.equal(done.status, 0)
    assert.equal(done.stdout, '')
  })
})

test('verify-edit reads the cache under the root it is given', () => {
  withDir((root) => {
    withDir((elsewhere) => {
      seedCache(root, 'https://api.github.com/repos/actions/checkout/git/refs/tags/v4', { object: { sha: 'abc1234def' } })
      const input = JSON.stringify({ file_path: '.github/workflows/ci.yml', content: 'uses: actions/checkout@v4\n' })
      const done = ds(['verify-edit', root], elsewhere, input)
      assert.equal(done.status, 0)
      const hits = JSON.parse(done.stdout) as { key: string; line: string }[]
      assert.deepEqual(hits, [
        {
          key: 'github_action_unpinned:uses: actions/checkout@v4',
          line: '⚠ verify[github_action_unpinned] uses: actions/checkout@v4 → uses: actions/checkout@abc1234def  # v4 · src: https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions',
        },
      ])
    })
  })
})

test('verify-edit prints nothing for benign content or a dossier path', () => {
  withDir((root) => {
    for (const edit of [
      { file_path: '.github/workflows/ci.yml', content: 'run: true\n' },
      { file_path: '.scratchpad/dossier/x/notes.yml', content: 'uses: actions/checkout@v4\n' },
    ]) {
      const done = ds(['verify-edit', root], root, JSON.stringify(edit))
      assert.equal(done.status, 0)
      assert.equal(done.stdout, '')
    }
  })
})

test('resolve-pins prints usage without a spec and an error object for a bad one', () => {
  withDir((dir) => {
    const bare = ds(['resolve-pins'], dir)
    assert.equal(bare.status, 2)
    assert.match(bare.stderr, /usage: ds resolve-pins/)
    const done = ds(['resolve-pins', 'nocolonspec', 'npm:react'], dir, '', { DOSSIER_VERIFY_CACHE_ONLY: '1' })
    assert.equal(done.status, 0)
    assert.equal(
      done.stdout,
      '{"spec": "nocolonspec", "error": "bad spec (want <ecosystem>:<pkg> or eol:<slug>)"}\n{"spec": "npm:react", "latest": null, "offline": true}\n',
    )
  })
})
