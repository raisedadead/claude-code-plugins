export type Label = { line: number; text: string }

const FENCE = /^\s*(```|~~~)/
const CODE = /`[^`]*`/g
const LABELS = [/(?<![\w./-])[A-Z]\d{1,3}(?![\w-])/g, /§\s?[A-Z]?\d*/g, /(?<![\w./-])[A-Za-z][\w-]*:\d+:\d+(?!\w)/g]

export function workingLabels(markdown: string): Label[] {
  const found: Label[] = []
  let fenced = false
  for (const [index, raw] of markdown.split('\n').entries()) {
    if (FENCE.test(raw)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const prose = raw.replace(CODE, '')
    const hits = LABELS.flatMap((pattern) => [...prose.matchAll(pattern)])
    for (const hit of hits.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))) found.push({ line: index + 1, text: hit[0].trim() })
  }
  return found
}
