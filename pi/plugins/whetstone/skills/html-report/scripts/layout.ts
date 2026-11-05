import { readFileSync } from 'node:fs'
import type { Marked as MarkedClass, Tokens } from 'marked'

export type Diagram = (source: string, n: number) => Promise<{ readonly svg: string; readonly title: string; readonly desc: string }>
export type Options = { readonly Marked: typeof MarkedClass; readonly diagram: Diagram }

type Heading = { readonly depth: number; readonly id: string; readonly text: string }
type Section = { readonly html: string; readonly title: string; readonly headings: readonly Heading[] }

const LONG_TABLE = 12
const FIXED = {
  answer: /^(?:summary|answer|the answer|tl;dr)$/i,
  decisions: /^(?:decisions|decisions for you)$/i,
  sources: /^(?:sources|references)$/i,
} as const

const CSS = readFileSync(new URL('./report.css', import.meta.url), 'utf8')
const SCRIPT = [
  "if (matchMedia('(max-width:980px)').matches) document.querySelector('nav.toc details').removeAttribute('open')",
  "const links = [...document.querySelectorAll('nav.toc a')]",
  'const heads = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean)',
  'const spy = () => {',
  '  let current = heads[0]',
  '  for (const h of heads) if (h.getBoundingClientRect().top < 120) current = h',
  "  for (const a of links) a.classList.toggle('on', a.hash.slice(1) === current?.id)",
  '}',
  "addEventListener('scroll', spy, { passive: true })",
  'spy()',
].join('\n')

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function plain(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function slugger(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text) => {
    const base =
      plain(text)
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '-') || 'section'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count ? `${base}-${count + 1}` : base
  }
}

function tables(html: string, collapse: boolean): string {
  return html.replace(/<table>[\s\S]*?<\/table>/g, (table) => {
    const rows = (table.match(/<tr>/g)?.length ?? 1) - 1
    const scroll = `<div class="scroll">${table}</div>`
    return collapse && rows > LONG_TABLE ? `<details class="long"><summary>Show table (${rows} rows)</summary>${scroll}</details>` : scroll
  })
}

function sections(body: string, headings: readonly Heading[]): { head: string; parts: Section[] } {
  const [head = '', ...rest] = body.split(/(?=<h2 id=")/)
  let at = headings.findIndex((h) => h.depth === 2)
  const parts = rest.map((html) => {
    const end = headings.findIndex((h, i) => i > at && h.depth === 2)
    const own = headings.slice(at, end < 0 ? undefined : end)
    at = end
    return { html, title: plain(own[0]?.text ?? '').replace(/^\d+(?:\.\d+)*\.?\s+/, ''), headings: own }
  })
  return { head, parts }
}

function take(parts: Section[], name: RegExp): Section | undefined {
  const index = parts.findIndex((part) => name.test(part.title))
  return index < 0 ? undefined : parts.splice(index, 1)[0]
}

function inner(section: Section): string {
  return section.html.replace(/^<h2 [^>]*>[\s\S]*?<\/h2>\s*/, '')
}

function link(id: string, text: string, depth: number): string {
  return `<li class="d${depth}"><a href="#${id}">${text}</a></li>`
}

function fixedLinks(section: Section | undefined, id: string, label: string): string {
  if (!section) return ''
  return link(id, label, 2) + section.headings.flatMap((h) => (h.depth === 3 ? [link(h.id, h.text, 3)] : [])).join('')
}

function box(section: Section | undefined, id: string, label: string, collapse: boolean): string {
  if (!section) return ''
  return `<section class="box ${id}" id="${id}"><h2 class="kicker">${label}</h2>${tables(inner(section), collapse)}</section>`
}

export async function buildReport(markdown: string, { Marked, diagram }: Options): Promise<string> {
  const figures = new Map<Tokens.Code, string>()
  const headings: Heading[] = []
  const slug = slugger()
  let count = 0
  let queue: Promise<void> = Promise.resolve()
  let failure = ''
  const marked = new Marked({
    async: true,
    gfm: true,
    walkTokens(token) {
      if (token.type !== 'code' || token.lang !== 'mermaid') return undefined
      const code = token as Tokens.Code
      const n = ++count
      queue = queue.then(async () => {
        const first = code.text.trim().split('\n')[0] ?? ''
        const drawn = await diagram(code.text, n).catch((error: unknown) => {
          const reason = (error instanceof Error ? error.message : String(error)).split('\n').filter((line) => !/\(https?:\/\//.test(line))
          failure = `diagram ${n} ("${first}"): ${reason.join('\n')}`
          throw new Error(failure)
        })
        const alt = escape([drawn.title, drawn.desc].filter(Boolean).join('. ') || `Diagram ${n}`)
        figures.set(code, `<figure class="diagram"><img alt="${alt}" src="data:image/svg+xml;base64,${Buffer.from(drawn.svg).toString('base64')}"></figure>\n`)
      })
      return queue
    },
    renderer: {
      heading({ tokens, depth }) {
        const text = this.parser.parseInline(tokens)
        const id = slug(text)
        headings.push({ depth, id, text })
        return `<h${depth} id="${id}">${text}</h${depth}>\n`
      },
      hr() {
        return ''
      },
      code(token) {
        return figures.get(token) ?? false
      },
    },
  })
  const body = await Promise.resolve(marked.parse(markdown)).catch((error: unknown) => {
    throw failure ? new Error(failure) : error
  })
  const { head, parts } = sections(body, headings)
  const answer = take(parts, FIXED.answer)
  const decisions = take(parts, FIXED.decisions)
  const sources = take(parts, FIXED.sources)
  const title = plain(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(head)?.[1] ?? 'Report')
  const meta = head.replace(/<h1[^>]*>[\s\S]*?<\/h1>/, '')
  const toc = [
    fixedLinks(answer, 'answer', 'The answer'),
    fixedLinks(decisions, 'decisions', 'Decisions for you'),
    ...parts.flatMap((part) => part.headings.flatMap((h) => (h.depth <= 3 ? [link(h.id, h.text, h.depth)] : []))),
    sources ? link('sources', 'Sources', 2) : '',
  ].join('')
  const main = [
    box(answer, 'answer', 'The answer', true),
    box(decisions, 'decisions', 'Decisions for you', false),
    ...parts.map((part) => tables(part.html.replace(/(<\/h2>\s*)<p>/, '$1<p class="lead">'), true)),
    sources ? `<details class="sources" id="sources"><summary>Sources</summary>${inner(sources)}</details>` : '',
  ].join('\n')
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title><style>${CSS}</style></head><body>
<a class="skip" href="#content">Skip to content</a>
<header class="top"><h1>${escape(title)}</h1><div class="meta">${meta}</div></header>
<div class="layout">
<nav class="toc" aria-label="Contents"><details open><summary class="kicker">On this page</summary><ol>${toc}</ol></details></nav>
<main id="content">
${main}
</main></div><script>${SCRIPT}</script></body></html>
`
}
