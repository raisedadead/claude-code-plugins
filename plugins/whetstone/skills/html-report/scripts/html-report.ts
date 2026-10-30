import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Marked } from 'marked'
import { workingLabels } from './labels.ts'
import { buildReport } from './layout.ts'
import { depsHome, ensureDeps, findChrome } from './runtime.ts'

type Shot = { screenshot(options: { path: string }): Promise<unknown> }
type Page = {
  setViewport(viewport: { width: number; height: number }): Promise<void>
  emulateMediaFeatures(features: { name: string; value: string }[]): Promise<void>
  goto(url: string, options: { waitUntil: 'load' }): Promise<unknown>
  $$(selector: string): Promise<Shot[]>
}
type Browser = { newPage(): Promise<Page>; close(): Promise<void> }
type Puppeteer = { launch(options: { executablePath: string; headless: boolean }): Promise<Browser> }
type Rendered = { data: Uint8Array; title?: string | null; desc?: string | null }
type MermaidCli = {
  renderMermaid(browser: Browser, definition: string, format: 'svg', options: { backgroundColor: string; svgId: string }): Promise<Rendered>
}

const SKILL = resolve(import.meta.dirname, '..')

function stop(code: number, message: string): never {
  process.stderr.write(`html-report: ${message}\n`)
  process.exit(code)
}

function has<K extends string>(value: unknown, key: K): value is Record<K, unknown> {
  return typeof value === 'object' && value !== null && key in value
}

function install(dir: string): void {
  process.stderr.write(`html-report: installing the renderer into ${dir} (first run only)\n`)
  const result = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--loglevel=error'], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, PUPPETEER_SKIP_DOWNLOAD: '1' },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  if (result.status !== 0) stop(69, `npm ci failed: ${result.error?.message ?? result.stderr.trim().split('\n').pop()}`)
}

async function load(deps: string, name: string): Promise<unknown> {
  const path = createRequire(join(deps, 'package.json')).resolve(name)
  return import(pathToFileURL(path).href)
}

const [source, target, ...extra] = process.argv.slice(2)
if (!source || !target || extra.length) stop(64, 'usage: html-report <report.md> <report.html>')
let markdown = ''
try {
  markdown = readFileSync(source, 'utf8')
} catch {
  stop(64, `cannot read ${source}`)
}

const chrome = findChrome(process.env, existsSync)
if (!chrome) stop(69, `no Chrome or Chromium found; set PUPPETEER_EXECUTABLE_PATH. The markdown stays at ${source}`)

const deps = depsHome(process.env)
ensureDeps(SKILL, deps, install)
const [markedModule, puppeteerModule, mermaidModule] = await Promise.all(
  ['marked', 'puppeteer', '@mermaid-js/mermaid-cli'].map((name) => load(deps, name)),
).catch(() => stop(69, `the renderer in ${deps} is incomplete; delete that directory and run again`))
if (!has(markedModule, 'Marked') || !has(puppeteerModule, 'default') || !has(mermaidModule, 'renderMermaid')) {
  stop(69, `the renderer in ${deps} is incomplete; delete that directory and run again`)
}
const puppeteer = puppeteerModule.default as Puppeteer
const mermaid = mermaidModule as unknown as MermaidCli

rmSync(target, { force: true })
const browser = await puppeteer.launch({ executablePath: chrome, headless: true }).catch((error: unknown) => {
  const reason = error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error)
  return stop(69, `${chrome} did not start: ${reason}`)
})
let failure = ''
try {
  const html = await buildReport(markdown, {
    Marked: markedModule.Marked as typeof Marked,
    diagram: async (definition, n) => {
      const { data, title, desc } = await mermaid.renderMermaid(browser, definition, 'svg', { backgroundColor: 'white', svgId: `figure-${n}` })
      return { svg: Buffer.from(data).toString('utf8'), title: title ?? '', desc: desc ?? '' }
    },
  })
  mkdirSync(dirname(resolve(target)), { recursive: true })
  writeFileSync(target, html)
  const page = await browser.newPage()
  await page.setViewport({ width: 1200, height: 900 })
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }])
  await page.goto(pathToFileURL(resolve(target)).href, { waitUntil: 'load' })
  const figures = await page.$$('figure.diagram')
  const shots = join(dirname(resolve(target)), `${basename(target, extname(target))}.figures`)
  rmSync(shots, { recursive: true, force: true })
  if (figures.length) mkdirSync(shots)
  for (const [i, figure] of figures.entries()) await figure.screenshot({ path: join(shots, `figure-${i + 1}.png`) })
  process.stdout.write(`wrote ${target} (${Math.round(statSync(target).size / 1024)} KB)\n`)
  if (figures.length) process.stdout.write(`figures: ${shots} (${figures.length}); read each one\n`)
  const labels = new Map<string, Set<number>>()
  for (const { line, text } of workingLabels(markdown)) labels.set(text, (labels.get(text) ?? new Set()).add(line))
  for (const [text, lines] of labels) {
    process.stderr.write(`html-report: "${text}" (${source} lines ${[...lines].join(', ')}) looks like a working label; name the thing by what it does, or define it\n`)
  }
} catch (error) {
  failure = error instanceof Error ? error.message : String(error)
} finally {
  await browser.close()
}
if (failure) stop(1, failure)
