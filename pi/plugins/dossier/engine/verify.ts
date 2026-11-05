import { compilePython } from './pyregex.ts'
import { strip, unicodeRegex } from './text.ts'
import { AI_MODEL_DEPRECATED, DOCKER_IMAGE_TO_SLUG, EOL_ALIAS_TO_SLUG, PKG_REGISTRY } from './verify-authorities.ts'

export type Status = 'ok' | 'missing' | 'offline'
export type LookupOptions = { ttl?: number; quiet?: boolean; timeout?: number }
export type Lookup = (url: string, options?: LookupOptions) => Promise<{ status: Status; data: unknown }>
export type Finding = readonly [claim: string, truth: string, src: string]
export type Scope = 'all' | 'yaml' | 'json' | 'md'
export type Rule = {
  name: string
  scope: Scope
  pathCheck?: (path: string) => boolean
  pattern: string
  args: number[]
  check: (...args: string[]) => Promise<Finding | undefined> | Finding | undefined
  icon: string
}
export type Hit = { rule: Rule; finding: Finding; key: string }
export type Pin = Record<string, string | boolean | null>

export const CACHE_TTL_DEFAULT = 86400
const CACHE_TTL_IMMUTABLE = 86400 * 30
export const HTTP_TIMEOUT_S = 5
export const GO_MAJOR_PROBE_MAX = 12
const GO_MAJOR_PROBE_TIMEOUT_S = 12
const GO_MAJOR_PROBE_WORKERS = 6
const GO_MAJOR_SUFFIX = /\/v[0-9]+(?=\n?$)/
const EOL_API = 'https://endoflife.date/api/v1/products/'
const ACTIONS_HARDENING = 'https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions'
const IMAGE_SUFFIXES = ['-alpine', '-slim', '-bullseye', '-bookworm', '-buster', '-jammy', '-noble', '-focal', '-trusty']
const SYMBOLIC_TAGS = new Set(['latest', 'stable', 'main', 'edge'])
const FLOATING_PINS = new Set(['latest', 'next', 'main', 'master', 'edge'])
const DIGITS = /^\p{Nd}+$/u
const SKIP_LINE = unicodeRegex('#\\s*verify-skip:\\s*([\\w,-]+)', 'g')
const LEADING_SPACE = unicodeRegex('^\\s+')
const K8S_DEPRECATED: Readonly<Record<string, string>> = {
  'extensions/v1beta1': 'networking.k8s.io/v1 (Ingress) or apps/v1 (Deployment/RS/DS)',
  'apps/v1beta1': 'apps/v1',
  'apps/v1beta2': 'apps/v1',
  'batch/v1beta1': 'batch/v1',
  'policy/v1beta1': 'policy/v1',
  'rbac.authorization.k8s.io/v1beta1': 'rbac.authorization.k8s.io/v1',
  'networking.k8s.io/v1beta1': 'networking.k8s.io/v1',
  'autoscaling/v2beta1': 'autoscaling/v2',
  'autoscaling/v2beta2': 'autoscaling/v2',
  'storage.k8s.io/v1beta1': 'storage.k8s.io/v1',
  'node.k8s.io/v1beta1': 'node.k8s.io/v1',
  'scheduling.k8s.io/v1beta1': 'scheduling.k8s.io/v1',
  'certificates.k8s.io/v1beta1': 'certificates.k8s.io/v1',
  'events.k8s.io/v1beta1': 'events.k8s.io/v1',
  'coordination.k8s.io/v1beta1': 'coordination.k8s.io/v1',
}

function own<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

function isDict(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (isDict(value)) return Object.keys(value).length > 0
  return Boolean(value)
}

function get(value: unknown, key: string, fallback: unknown = null): unknown {
  if (!isDict(value)) throw new TypeError(`'${typeof value}' object has no attribute 'get'`)
  return Object.hasOwn(value, key) ? value[key] : fallback
}

function pyStr(value: unknown): string {
  if (value === null || value === undefined) return 'None'
  if (value === true) return 'True'
  if (value === false) return 'False'
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function format(url: string, pkg: string): string {
  return url.replace('{pkg}', () => pkg)
}

async function cached(lookup: Lookup, url: string, ttl = CACHE_TTL_DEFAULT): Promise<unknown> {
  return (await lookup(url, { ttl })).data
}

async function eolReleases(lookup: Lookup, slug: string): Promise<unknown[]> {
  const data = await cached(lookup, `${EOL_API}${slug}`)
  if (!truthy(data)) return []
  if (isDict(data)) {
    const releases = get(get(data, 'result', {}), 'releases', [])
    return Array.isArray(releases) ? releases : []
  }
  return Array.isArray(data) ? data : []
}

async function latestEol(lookup: Lookup, slug: string): Promise<[string, string, string] | undefined> {
  const releases = await eolReleases(lookup, slug)
  const current = releases.find((release) => !truthy(get(release, 'isEol')))
  if (current === undefined) return undefined
  const series = pyStr(get(current, 'name', '?'))
  const latest = get(current, 'latest')
  const exact = isDict(latest) ? pyStr(get(latest, 'name', series)) : typeof latest === 'string' ? latest : series
  return [series, exact, `${EOL_API}${slug}`]
}

function stripImageTag(tag: string): string {
  const suffix = IMAGE_SUFFIXES.find((end) => tag.endsWith(end))
  const bare = suffix ? tag.slice(0, -suffix.length) : tag
  return bare.includes('-') && !bare.startsWith('v') ? (bare.split('-')[0] ?? '') : bare
}

function dotGet(data: unknown, path: readonly (string | number)[]): unknown {
  let current = data
  for (const key of path) {
    if (typeof key === 'string' && isDict(current)) current = Object.hasOwn(current, key) ? current[key] : null
    else if (typeof key === 'number' && Array.isArray(current) && -current.length <= key && key < current.length) {
      current = current.at(key)
    } else return null
    if (current === null || current === undefined) return null
  }
  return current
}

function aliasToSlug(alias: string): string | undefined {
  const lower = alias.toLowerCase()
  return own(EOL_ALIAS_TO_SLUG, lower) || own(EOL_ALIAS_TO_SLUG, lower.replace(/[. _]/g, '')) || undefined
}

export async function checkEol(lookup: Lookup, slug: string, version: string): Promise<Finding | undefined> {
  const releases = await eolReleases(lookup, slug)
  if (!releases.length) return undefined
  const parts = version.replace(/^[vV]+/, '').split('.')
  const major = parts[0] ?? ''
  if (!DIGITS.test(major)) return undefined
  const minor = parts.length > 1 && DIGITS.test(parts[1] ?? '') ? parts[1] : undefined
  const named = (release: unknown, prefix: string): boolean => pyStr(get(release, 'name', '')).startsWith(prefix)
  let candidates = releases.filter((release) => named(release, major))
  if (minor) {
    const narrowed = candidates.filter((release) => named(release, `${major}.${minor}`))
    if (narrowed.length) candidates = narrowed
  }
  const release = candidates[0]
  if (release === undefined || !truthy(get(release, 'isEol'))) return undefined
  const live = releases.find((entry) => !truthy(get(entry, 'isEol')))
  const current = live === undefined ? '?' : get(live, 'name')
  const eolFrom = get(release, 'eolFrom')
  const eol = get(release, 'eol')
  const date = truthy(eolFrom) ? eolFrom : truthy(eol) ? eol : '?'
  return [`${slug} ${version}`, `current: ${slug} ${pyStr(current)}. v${pyStr(get(release, 'name'))} EOL ${pyStr(date)}.`, `${EOL_API}${slug}`]
}

export async function checkFreetext(lookup: Lookup, alias: string, version: string): Promise<Finding | undefined> {
  const slug = aliasToSlug(alias)
  if (!slug) return undefined
  const finding = await checkEol(lookup, slug, version)
  return finding ? [`${alias} ${version}`, finding[1], finding[2]] : undefined
}

type Probe = [Status, [string, string] | undefined]

async function goProbe(lookup: Lookup, module: string, timeout = HTTP_TIMEOUT_S): Promise<Probe> {
  const registry = PKG_REGISTRY.go!
  const url = format(registry.url, module)
  const { status, data } = await lookup(url, { quiet: true, timeout })
  if (status !== 'ok') return [status, undefined]
  const version = dotGet(data, registry.path)
  return typeof version === 'string' && version ? ['ok', [version, url]] : ['missing', undefined]
}

async function inPool<T, R>(items: T[], workers: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const at = next++
      results[at] = await task(items[at] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker))
  return results
}

type Detail = [string, string, string | undefined]

async function goLatest(lookup: Lookup, pkg: string): Promise<Detail | undefined> {
  const [status, base] = await goProbe(lookup, pkg, GO_MAJOR_PROBE_TIMEOUT_S)
  if (status === 'offline' || GO_MAJOR_SUFFIX.test(pkg)) return base ? [base[0], base[1], undefined] : undefined
  const majors = Array.from({ length: GO_MAJOR_PROBE_MAX - 1 }, (_, at) => at + 2)
  const probed = await inPool(majors, GO_MAJOR_PROBE_WORKERS, (major) => goProbe(lookup, `${pkg}/v${major}`, GO_MAJOR_PROBE_TIMEOUT_S))
  let best = base
  let bestMajor = 1
  probed.forEach(([found, answer], at) => {
    if (found === 'ok') {
      best = answer
      bestMajor = majors[at] ?? bestMajor
    }
  })
  const unknown = majors.filter((major, at) => probed[at]?.[0] === 'offline' && major > bestMajor).map((major) => `/v${major}`)
  if (!best) return undefined
  let warning: string | undefined
  if (unknown.length) warning = `the go proxy did not answer for ${unknown.join(', ')} — a higher major may exist`
  else if (bestMajor === GO_MAJOR_PROBE_MAX) warning = `/v${GO_MAJOR_PROBE_MAX} is the highest major probed — a higher major may exist`
  return [best[0], best[1], warning]
}

export async function latestVersionDetail(lookup: Lookup, ecosystem: string, pkg: string): Promise<Detail | undefined> {
  if (ecosystem === 'go') return goLatest(lookup, pkg)
  const result = await latestVersion(lookup, ecosystem, pkg)
  return result ? [result[0], result[1], undefined] : undefined
}

export async function latestVersion(lookup: Lookup, ecosystem: string, pkg: string): Promise<[string, string] | undefined> {
  const registry = own(PKG_REGISTRY, ecosystem)
  if (!registry) return undefined
  if (ecosystem === 'go') return (await goProbe(lookup, pkg))[1]
  const url = format(registry.url, pkg)
  const data = await cached(lookup, url)
  let latest: unknown
  if (registry.path.length === 1 && registry.path[0] === '__lookup_packagist_first__') {
    if (!isDict(data)) return undefined
    const packages = get(data, 'packages')
    const releases = get(truthy(packages) ? packages : {}, pkg)
    if (truthy(releases)) {
      if (!Array.isArray(releases)) throw new TypeError('packagist releases are not a list')
      latest = get(releases[0], 'version')
    }
  } else {
    latest = dotGet(data, registry.path)
    if (typeof latest !== 'string' || !latest) latest = registry.fallbackPath ? dotGet(data, registry.fallbackPath) : null
  }
  return typeof latest === 'string' && latest ? [latest, url] : undefined
}

function digitValue(digit: string): number {
  let zero = digit.codePointAt(0) ?? 0
  while (/\p{Nd}/u.test(String.fromCodePoint(zero - 1))) zero--
  return ((digit.codePointAt(0) ?? 0) - zero) % 10
}

function semverMajor(version: string): number | undefined {
  const bare = strip(version)
    .replace(/^v+/, '')
    .replace(/^[\^~>=<*]+/, '')
  if (!bare || bare === 'latest' || bare === 'next' || bare === '*') return undefined
  const head = bare.split('.')[0] ?? ''
  if (!DIGITS.test(head)) return undefined
  return [...head].reduce((total, digit) => total * 10 + digitValue(digit), 0)
}

export async function checkPkgOutdated(lookup: Lookup, ecosystem: string, pkg: string, version: string): Promise<Finding | undefined> {
  const pinned = version.replace(LEADING_SPACE, '').replace(/^["']+|["']+$/g, '')
  if (/^[\^~><*]/.test(pinned) || FLOATING_PINS.has(pinned)) return undefined
  const pinnedMajor = semverMajor(pinned)
  if (pinnedMajor === undefined) return undefined
  const result = await latestVersion(lookup, ecosystem, pkg)
  if (!result) return undefined
  const [latest, url] = result
  const latestMajor = semverMajor(latest)
  if (latestMajor === undefined || pinnedMajor >= latestMajor - 1) return undefined
  return [`${ecosystem}:${pkg}@${version}`, `${pkg}@${latest} (latest)`, url]
}

export async function checkImageTag(lookup: Lookup, image: string, tag: string): Promise<Finding | undefined> {
  if (!tag || SYMBOLIC_TAGS.has(tag)) return undefined
  const slug = own(DOCKER_IMAGE_TO_SLUG, image.toLowerCase())
  if (!slug) return undefined
  const finding = await checkEol(lookup, slug, stripImageTag(tag))
  return finding ? [`FROM ${image}:${tag}`, finding[1], finding[2]] : undefined
}

export async function checkActionSha(lookup: Lookup, repo: string, ref: string): Promise<Finding | undefined> {
  if (/^[0-9a-f]{7,40}$/.test(ref)) return undefined
  const data = await cached(lookup, `https://api.github.com/repos/${repo}/git/refs/tags/${ref}`, CACHE_TTL_IMMUTABLE)
  const sha = isDict(data) ? get(get(data, 'object', {}), 'sha', '') : ''
  const suggestion = truthy(sha) ? `uses: ${repo}@${pyStr(sha)}  # ${ref}` : `resolve: gh api repos/${repo}/git/refs/tags/${ref}`
  return [`uses: ${repo}@${ref}`, suggestion, ACTIONS_HARDENING]
}

function checkK8sApiVersion(matched: string): Finding | undefined {
  const replacement = own(K8S_DEPRECATED, matched)
  return replacement === undefined
    ? undefined
    : [`apiVersion: ${matched}`, `apiVersion: ${replacement}`, 'https://kubernetes.io/docs/reference/using-api/deprecation-guide/']
}

function checkAiModel(model: string): Finding | undefined {
  if (!model) return undefined
  const name = strip(model).replace(/^["']+|["']+$/g, '')
  const entry = own(AI_MODEL_DEPRECATED, name) || own(AI_MODEL_DEPRECATED, name.toLowerCase())
  if (!entry) return undefined
  const [status, when, replacement, src] = entry
  return [`model: ${model}`, `${status} (${when}). use: ${replacement}`, src]
}

function escapePython(text: string): string {
  return text.replace(/[^A-Za-z0-9_]/g, '\\$&')
}

function baseName(path: string): string {
  return path.split('/').pop() ?? ''
}

function endsWithAny(path: string, ends: string[]): boolean {
  return ends.some((end) => path.endsWith(end))
}

const isYaml = (path: string): boolean => endsWithAny(path, ['.yml', '.yaml'])
const isWorkflow = (path: string): boolean => path.includes('.github/workflows/') && isYaml(path)
const isDockerfile = (path: string): boolean => {
  const name = baseName(path)
  return name === 'Dockerfile' || name.startsWith('Dockerfile.') || endsWithAny(name, ['.dockerfile', '.Dockerfile'])
}
const isCompose = (path: string): boolean => ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'].includes(baseName(path))
const isRequirements = (path: string): boolean => {
  const name = baseName(path)
  return name === 'requirements.txt' || (name.startsWith('requirements-') && name.endsWith('.txt'))
}

export function patterns(lookup: Lookup): Rule[] {
  const aliases = Object.keys(EOL_ALIAS_TO_SLUG).sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  const freetext = `(?i)(?<![A-Za-z0-9._-])(${aliases.map(escapePython).join('|')})\\s*[vV]?(\\d+(?:\\.\\d+){0,3})\\b`
  const outdated = (ecosystem: string) => (pkg: string, version: string) => checkPkgOutdated(lookup, ecosystem, pkg, version)
  return [
    {
      name: 'lang_eol_prose',
      scope: 'all',
      pattern: freetext,
      check: (alias, version) => checkFreetext(lookup, alias, version),
      args: [1, 2],
      icon: '⚠',
    },
    {
      name: 'docker_image_eol',
      scope: 'all',
      pathCheck: (path) => isDockerfile(path) || isCompose(path) || isYaml(path),
      pattern: '(?m)(?:^|\\s)(?:FROM|image:)\\s+([\\w./-]+):([\\w.+-]+)',
      check: (image, tag) => checkImageTag(lookup, image, tag),
      args: [1, 2],
      icon: '⚠',
    },
    {
      name: 'github_action_unpinned',
      scope: 'yaml',
      pathCheck: isWorkflow,
      pattern: 'uses:\\s+([\\w.-]+/[\\w.-]+)@([\\w.-]+)\\b',
      check: (repo, ref) => checkActionSha(lookup, repo, ref),
      args: [1, 2],
      icon: '⚠',
    },
    {
      name: 'k8s_deprecated_api',
      scope: 'yaml',
      pathCheck: isYaml,
      pattern: 'apiVersion:\\s+([\\w./-]+)',
      check: checkK8sApiVersion,
      args: [1],
      icon: '⚠',
    },
    {
      name: 'npm_outdated',
      scope: 'json',
      pathCheck: (path) => path.endsWith('package.json'),
      pattern: '"([@\\w][\\w./-]*)"\\s*:\\s*"([0-9][\\w.+-]*)"',
      check: outdated('npm'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'pypi_outdated_reqs',
      scope: 'all',
      pathCheck: isRequirements,
      pattern: '(?m)^\\s*([A-Za-z][A-Za-z0-9._-]*)\\s*==\\s*([0-9][\\w.+-]*)',
      check: outdated('pypi'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'pypi_outdated_pyproject',
      scope: 'all',
      pathCheck: (path) => endsWithAny(path, ['pyproject.toml', 'Pipfile']),
      pattern: '"([A-Za-z][A-Za-z0-9._-]*)\\s*==\\s*([0-9][\\w.+-]*)"',
      check: outdated('pypi'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'crates_outdated',
      scope: 'all',
      pathCheck: (path) => path.endsWith('Cargo.toml'),
      pattern: '(?m)^([a-z][a-z0-9_-]*)\\s*=\\s*"([0-9][\\w.+-]*)"',
      check: outdated('crates'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'rubygems_outdated',
      scope: 'all',
      pathCheck: (path) => ['Gemfile', 'Gemfile.lock'].includes(baseName(path)),
      pattern: 'gem\\s+[\'"]([\\w.-]+)[\'"]\\s*,\\s*[\'"]([0-9][\\w.+-]*)[\'"]',
      check: outdated('rubygems'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'go_module_outdated',
      scope: 'all',
      pathCheck: (path) => path.endsWith('go.mod'),
      pattern: '(?m)^\\s*([\\w./-]+)\\s+v([0-9][\\w.+-]*)',
      check: outdated('go'),
      args: [1, 2],
      icon: 'ℹ',
    },
    {
      name: 'ai_model_deprecated',
      scope: 'all',
      pattern: '(?:model(?:_name)?|"model")\\s*[=:]\\s*[\'"]([\\w.:-]+)[\'"]',
      check: checkAiModel,
      args: [1],
      icon: '⚠',
    },
  ]
}

function scopeOk(scope: Scope, path: string): boolean {
  if (scope === 'yaml') return isYaml(path)
  if (scope === 'json') return path.endsWith('.json')
  if (scope === 'md') return path.endsWith('.md')
  return true
}

function skipSet(content: string): Set<string> {
  const names = new Set<string>()
  for (const match of content.matchAll(SKIP_LINE)) {
    for (const name of (match[1] ?? '').split(',')) if (strip(name)) names.add(strip(name))
  }
  return names
}

export async function scan(content: string, path: string, rules: Rule[]): Promise<Hit[]> {
  const skipped = skipSet(content)
  const hits: Hit[] = []
  const seen = new Set<string>()
  for (const rule of rules) {
    if (skipped.has(rule.name) || !scopeOk(rule.scope, path)) continue
    if (rule.pathCheck && path && !rule.pathCheck(path)) continue
    const regex = compilePython(rule.pattern)
    if (!regex) continue
    for (const match of content.matchAll(new RegExp(regex.source, `${regex.flags}g`))) {
      let finding: Finding | undefined
      try {
        finding = await rule.check(...rule.args.map((group) => match[group] ?? ''))
      } catch {
        finding = undefined
      }
      if (!finding) continue
      const key = `${rule.name}:${finding[0]}`
      if (seen.has(key)) continue
      seen.add(key)
      hits.push({ rule, finding, key })
    }
  }
  return hits
}

export async function resolvePin(lookup: Lookup, raw: string): Promise<Pin> {
  const spec = strip(raw)
  if (spec.startsWith('eol:')) {
    const result = await latestEol(lookup, spec.slice(4))
    if (!result) return { spec, latest: null, offline: true }
    return { spec, series: result[0], latest: result[1], src: result[2] }
  }
  const at = spec.indexOf(':')
  if (at >= 0) {
    const result = await latestVersionDetail(lookup, spec.slice(0, at), spec.slice(at + 1))
    if (!result) return { spec, latest: null, offline: true }
    return result[2] ? { spec, latest: result[0], src: result[1], warning: result[2] } : { spec, latest: result[0], src: result[1] }
  }
  return { spec, error: 'bad spec (want <ecosystem>:<pkg> or eol:<slug>)' }
}
