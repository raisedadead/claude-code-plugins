import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Marked } from 'marked'
import { test } from 'vitest'
import { buildReport, type Diagram } from '../skills/html-report/scripts/layout.ts'
import { depsHome, ensureDeps, findChrome } from '../skills/html-report/scripts/runtime.ts'

const SKILL = join(import.meta.dirname, '..', 'skills', 'html-report')
const FIXTURE = readFileSync(join(import.meta.dirname, 'fixtures', 'report.md'), 'utf8')
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>ok</text></svg>'
const CLI = join(SKILL, 'scripts', 'html-report.ts')
const drawn: Diagram = async () => ({ svg: SVG, title: '', desc: '' })

function build(markdown: string, diagram: Diagram = drawn): Promise<string> {
  return buildReport(markdown, { Marked, diagram })
}

function at(html: string, needle: string): number {
  const index = html.indexOf(needle)
  assert.ok(index >= 0, `missing ${needle}`)
  return index
}

test('puts the answer and the decisions above the body and the sources last', async () => {
  const html = await build(FIXTURE)
  const main = html.slice(at(html, '<main'))
  assert.ok(at(main, 'class="box answer"') < at(main, 'class="box decisions"'))
  assert.ok(at(main, 'class="box decisions"') < at(main, '<h2 id="1-context"'))
  assert.ok(at(main, '<h2 id="4-risks"') < at(main, 'class="sources"'))
  assert.doesNotMatch(html, /<h2[^>]*>Summary</)
})

test('lists the body headings in the contents with the three fixed links', async () => {
  const html = await build(FIXTURE)
  const nav = html.slice(at(html, '<nav'), at(html, '</nav>'))
  for (const id of ['answer', 'decisions', '1-context', '11-current-cache', '3-measurements', 'sources']) at(nav, `href="#${id}"`)
  assert.doesNotMatch(nav, /href="#summary"/)
})

test('collapses a table over 12 rows and leaves a short table open', async () => {
  const html = await build(FIXTURE)
  assert.equal(html.match(/<details class="long">/g)?.length, 1)
  at(html, 'Show table (13 rows)')
})

test('keeps a heading that only resembles a fixed section in the body', async () => {
  const html = await build('# T\n\n## Decision log\n\nx\n\n## Questions for reviewers\n\ny\n')
  assert.doesNotMatch(html, /class="box/)
  at(html, '<h2 id="decision-log"')
})

test('embeds each diagram as an image with its title and description as the alt text', async () => {
  const html = await build(FIXTURE, async () => ({ svg: SVG, title: 'Read & write', desc: 'Every write goes to Redis' }))
  const image = /<figure class="diagram"><img alt="([^"]*)" src="data:image\/svg\+xml;base64,([^"]+)"><\/figure>/.exec(html)
  assert.ok(image)
  assert.equal(image[1], 'Read &amp; write. Every write goes to Redis')
  assert.equal(Buffer.from(image[2] ?? '', 'base64').toString('utf8'), SVG)
  assert.doesNotMatch(html, /flowchart LR/)
})

test('fails the build on a diagram that does not render, and names it', async () => {
  const markdown = '# T\n\n```mermaid\ngraph TD\n  A-->B\n```\n\n```mermaid\ngraph TD; A-->\n```\n'
  const broken: Diagram = async (source) => {
    if (source.includes('A-->\n') || source.endsWith('A-->')) throw new Error('Parse error on line 1')
    return { svg: SVG, title: '', desc: '' }
  }
  await assert.rejects(build(markdown, broken), (error: Error) => {
    assert.equal(error.message, 'diagram 2 ("graph TD; A-->"): Parse error on line 1')
    return true
  })
})

test('escapes the page title', async () => {
  const html = await build('# A <b>bold</b> & co\n\ntext\n')
  at(html, '<title>A bold &amp; co</title>')
})

test('honours PUPPETEER_EXECUTABLE_PATH strictly and otherwise takes the first browser found', () => {
  const real = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  const exists = (path: string): boolean => path === real || path === '/opt/chrome'
  assert.equal(findChrome({ PUPPETEER_EXECUTABLE_PATH: '/opt/chrome' }, exists), '/opt/chrome')
  assert.equal(findChrome({ PUPPETEER_EXECUTABLE_PATH: '/nope' }, exists), undefined)
  assert.equal(findChrome({}, exists), real)
  assert.equal(
    findChrome({}, () => false),
    undefined,
  )
})

test('installs the renderer once and again only when the lockfile changes', () => {
  const root = mkdtempSync(join(tmpdir(), 'html-report-'))
  try {
    const skill = join(root, 'skill')
    const deps = join(root, 'deps')
    for (const [name, body] of [
      ['package.json', '{}'],
      ['package-lock.json', '{"v":1}'],
    ] as const) {
      spawnSync('mkdir', ['-p', skill])
      writeFileSync(join(skill, name), body)
    }
    const runs: string[] = []
    const install = (dir: string): void => {
      runs.push(dir)
      spawnSync('mkdir', ['-p', join(dir, 'node_modules')])
    }
    assert.equal(ensureDeps(skill, deps, install), true)
    assert.equal(ensureDeps(skill, deps, install), false)
    writeFileSync(join(skill, 'package-lock.json'), '{"v":2}')
    assert.equal(ensureDeps(skill, deps, install), true)
    assert.deepEqual(runs, [deps, deps])
    assert.equal(readFileSync(join(deps, 'package-lock.json'), 'utf8'), '{"v":2}')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('stops with one line and writes nothing when no browser is found', () => {
  const root = mkdtempSync(join(tmpdir(), 'html-report-'))
  try {
    const out = join(root, 'out.html')
    const result = spawnSync(process.execPath, [CLI, join(import.meta.dirname, 'fixtures', 'report.md'), out], {
      encoding: 'utf8',
      env: { ...process.env, PUPPETEER_EXECUTABLE_PATH: join(root, 'nope'), CLAUDE_PLUGIN_DATA: root },
    })
    assert.equal(result.status, 69, result.stderr)
    assert.equal(result.stderr.trim().split('\n').length, 1)
    assert.match(result.stderr, /no Chrome or Chromium/)
    assert.equal(existsSync(out), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('pins the same marked version for the tests and the renderer', () => {
  const pin = (path: string): unknown =>
    JSON.parse(readFileSync(path, 'utf8')).dependencies?.marked ?? JSON.parse(readFileSync(path, 'utf8')).devDependencies?.marked
  assert.equal(pin(join(SKILL, 'package.json')), pin(join(import.meta.dirname, '..', '..', '..', 'package.json')))
})

test('keeps the renderer in the plugin data directory, or in the user cache without one', () => {
  assert.equal(depsHome({ CLAUDE_PLUGIN_DATA: '/data/whetstone' }), '/data/whetstone/html-report')
  assert.equal(depsHome({ XDG_CACHE_HOME: '/cache', HOME: '/home/u' }), '/cache/whetstone/html-report')
  assert.match(depsHome({}), /\/\.cache\/whetstone\/html-report$/)
})

const ready = findChrome(process.env, existsSync) !== undefined && existsSync(join(depsHome(process.env), 'node_modules'))

test.skipIf(!ready)('exits 1 on a broken diagram and removes the earlier page', () => {
  const root = mkdtempSync(join(tmpdir(), 'html-report-'))
  try {
    const source = join(root, 'bad.md')
    const out = join(root, 'bad.html')
    writeFileSync(source, '# T\n\n```mermaid\ngraph TD; A-->\n```\n')
    writeFileSync(out, 'stale')
    const result = spawnSync(process.execPath, [CLI, source, out], { encoding: 'utf8' })
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, /^html-report: diagram 1 \("graph TD; A-->"\): Parse error/)
    assert.equal(existsSync(out), false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
