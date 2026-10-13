export const meta = {
  name: 'verify-claims',
  description: 'Gather sourced claims for a question with scouts, then verify each claim against its own source in batches',
  whenToUse:
    'When an answer must rest on verified claims: research questions, version-sensitive facts, disputed assertions. Pass args.question, or args.claims[] ({claim, source, date?, primary?}) to skip gathering; args.scouts (default 2); args.batch (claims per grounder, default 5).',
  phases: [
    { title: 'Gather', detail: 'scouts build a claim table' },
    { title: 'Verify', detail: 'one adversarial grounder per batch of claims' },
  ],
}

let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    input = { question: input }
  }
}
input = input || {}

const question = input.question || ''
const SCOUTS = { least: 1, most: 4, usual: 2 }
const BATCH = { least: 1, most: 10, usual: 5 }
const scouts = Math.max(SCOUTS.least, Math.min(SCOUTS.most, Number(input.scouts) || SCOUTS.usual))
const size = Math.max(BATCH.least, Math.min(BATCH.most, Number(input.batch) || BATCH.usual))

if (!question && !(input.claims || []).length) {
  return { error: 'verify-claims needs args.question or args.claims[]' }
}

const CLAIMS = {
  type: 'object',
  required: ['claims'],
  properties: {
    claims: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'source', 'date', 'primary'],
        properties: {
          claim: { type: 'string' },
          source: { type: 'string' },
          date: { type: 'string' },
          primary: { type: 'boolean' },
        },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const VERDICTS = {
  type: 'object',
  required: ['verdicts'],
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'verdict', 'quote', 'why'],
        properties: {
          id: { type: 'integer' },
          quote: { type: 'string', minLength: 1 },
          verdict: { type: 'string', enum: ['CONFIRMED', 'UNSUPPORTED', 'CONTRADICTED', 'SOURCE-DEAD'] },
          why: { type: 'string' },
        },
      },
    },
    gaps: { type: 'array', items: { type: 'string' } },
  },
}

const claims = (input.claims || []).map((c) => ({ claim: String(c.claim), source: String(c.source), date: c.date || '', primary: Boolean(c.primary) }))
const gaps = []

if (!claims.length) {
  phase('Gather')
  const angles = ['official docs and specs first', 'source code, changelogs and issue trackers first', 'independent measurements and reports first']
  const gathered = await parallel(
    Array.from(
      { length: scouts },
      (_, i) => () =>
        agent(`QUESTION: ${question}\nSearch angle: ${angles[i % angles.length]}. Return every claim relevant to the question.`, {
          label: `scout:${i + 1}`,
          phase: 'Gather',
          schema: CLAIMS,
          agentType: 'whetstone:whetstone-scout',
        }),
    ),
  )
  const seen = new Set()
  for (const found of gathered.filter(Boolean)) {
    for (const c of found.claims || []) {
      const key = c.claim.toLowerCase().replace(/\s+/g, ' ').trim()
      if (seen.has(key)) continue
      seen.add(key)
      claims.push(c)
    }
    gaps.push(...(found.gaps || []))
  }
  const missing = scouts - gathered.filter(Boolean).length
  if (missing) log(`${missing} of ${scouts} scouts returned nothing`)
}

if (!claims.length) {
  log('no claims to verify')
  return { error: 'the scouts returned no claims', question, claims: [], gaps, tally: {} }
}

const batches = []
for (let i = 0; i < claims.length; i += size) batches.push(claims.slice(i, i + size))
log(`${claims.length} claims in ${batches.length} batches of up to ${size}`)

phase('Verify')
const ruled = await parallel(
  batches.map((batch, b) => () => {
    const list = batch
      .map((c, i) => `${i + 1}. CLAIM: ${c.claim}\n   SOURCE: ${c.source}${c.date ? ` (dated ${c.date})` : ''}${c.primary ? ' (primary)' : ''}`)
      .join('\n')
    return agent(`${question ? `QUESTION: ${question}\n` : ''}Verify each claim against its cited source. Rule on every id.\n${list}`, {
      label: `verify:batch ${b + 1}`,
      phase: 'Verify',
      schema: VERDICTS,
      agentType: 'whetstone:whetstone-grounder',
    }).then((result) => {
      gaps.push(...((result && result.gaps) || []))
      return batch.map((c, i) => {
        const v = ((result && result.verdicts) || []).find((x) => x.id === i + 1 && String(x.quote || '').trim())
        return v
          ? { ...c, verdict: v.verdict, quote: v.quote, why: v.why }
          : { ...c, verdict: 'UNRULED', quote: '', why: 'the grounder returned no ruling for this claim' }
      })
    })
  }),
)

const rows = ruled.flatMap((batch, b) => batch || batches[b].map((c) => ({ ...c, verdict: 'UNRULED', quote: '', why: 'the grounder for this batch failed' })))
const tally = {}
for (const r of rows) tally[r.verdict] = (tally[r.verdict] || 0) + 1
if (tally.UNRULED) log(`${tally.UNRULED} claims have no ruling`)
log(`verdicts: ${JSON.stringify(tally)}`)
return { question, claims: rows, gaps, tally }
