export type Label = { line: number; text: string }

const FENCE = /^\s*(```|~~~)/
const OPEN_ITEM = /^\s*[-*] [A-Z]\d+ \[H\] /
const HIDDEN = [/`[^`]*`/g, /<!--.*?-->/g]
const LABELS = [/(?<![\w./§-])[A-Z]\d{1,4}(?![\w-])/g, /§[A-Z0-9]+/g, /(?<![\w./-])[A-Za-z][\w-]*:\d+[.:]\d+(?!\w)/g]
const COMMON = new Set(['S3', 'Q1', 'Q2', 'Q3', 'Q4'])

export function workingLabels(markdown: string): Label[] {
  const found: Label[] = []
  let fenced = false
  for (const [index, raw] of markdown.split('\n').entries()) {
    if (FENCE.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced || OPEN_ITEM.test(raw)) continue
    const prose = HIDDEN.reduce((text, pattern) => text.replace(pattern, ''), raw)
    const hits = LABELS.flatMap((pattern) => [...prose.matchAll(pattern)]).filter((hit) => !COMMON.has(hit[0]))
    for (const hit of hits.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) found.push({ line: index + 1, text: hit[0] })
  }
  return found
}
