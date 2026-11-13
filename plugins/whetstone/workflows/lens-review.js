export const meta = {
  name: 'lens-review',
  description: 'Multi-lens diff review (slop, security, tests, smells, and spec when args.spec is set) with an adversarial refute pass per finding',
  whenToUse:
    'After a change to source files, before the push. Pass args.baseRef (default: working tree vs HEAD), optionally args.repo (default ".") and args.spec (a path or URL to the issue or spec; adds the spec lens).',
  phases: [
    { title: 'Review', detail: '4 lens reviewers over the diff, 5 with args.spec' },
    { title: 'Verify', detail: 'refute pass per finding' },
  ],
}

let input = args
if (typeof input === 'string') {
  try {
    input = JSON.parse(input)
  } catch {
    input = {}
  }
}
input = input || {}

const REVIEWER = 'whetstone:whetstone-reviewer'
const repo = input.repo || '.'
const baseRef = input.baseRef || ''
const spec = input.spec || ''
const SPEC_SCOPE = `\nSPEC: ${spec}. Read it yourself: a file with Read, an issue URL with \`gh issue view <url>\`, another URL with \`curl -sL <url>\`.`
const diffCmd = baseRef
  ? `git -C ${repo} diff ${baseRef}...HEAD && git -C ${repo} diff HEAD && git -C ${repo} log --oneline ${baseRef}..HEAD`
  : `git -C ${repo} diff HEAD && git -C ${repo} status --short`

const SCOPE = `DIFF UNDER REVIEW: run \`${diffCmd}\` yourself to obtain it. Repo: ${repo}.
You are read-only: no edits, no commits, no state mutations. Cite path:line for every finding. A finding you cannot point at a line for is not a finding.`

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'line', 'severity', 'problem', 'fix'],
        properties: {
          file: { type: 'string' },
          line: { type: 'number' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'note'] },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
      },
    },
  },
}

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['real', 'why'],
  properties: { real: { type: 'boolean' }, why: { type: 'string' } },
}

const SMELLS = `- Mysterious Name: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- Duplicated Code: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- Feature Envy: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- Data Clumps: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- Primitive Obsession: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- Repeated Switches: the same switch/if-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- Shotgun Surgery: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- Divergent Change: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- Speculative Generality: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- Message Chains: long a.b().c().d() navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- Middle Man: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- Refused Bequest: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.`

const LENSES = [
  {
    key: 'slop',
    prompt: `${SCOPE}\nLENS: slop. For this run, apply your Slop lens only — security, tests and smells go to the other reviewers.`,
  },
  {
    key: 'security',
    prompt: `${SCOPE}\nLENS: security. For this run, apply your Security lens only — slop, tests and smells go to the other reviewers.`,
  },
  {
    key: 'tests',
    prompt: `${SCOPE}\nLENS: tests & correctness. Changed behaviour without a covering test, tests that pass against the old behaviour, edge cases the diff introduces (empty input, unicode, concurrency, error paths), silent regressions in untouched callers of changed signatures.`,
  },
  {
    key: 'smells',
    prompt: `${SCOPE}\nLENS: smells. For this run, apply the twelve Fowler smells below only — slop, security and tests go to the other reviewers. Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation; a documented repo standard wins where it endorses the shape; skip anything tooling already enforces. Read each smell as what it is → how to fix, and match it against the diff.\n${SMELLS}`,
  },
  ...(spec
    ? [
        {
          key: 'spec',
          extra: SPEC_SCOPE,
          prompt: `${SCOPE}${SPEC_SCOPE}\nLENS: spec. Report (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that the spec did not ask for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line in each problem. For a missing requirement, give the spec file and line as file and line. Slop, security, tests and smells go to the other reviewers.`,
        },
      ]
    : []),
]

const results = await pipeline(
  LENSES,
  (lens) =>
    agent(lens.prompt, {
      label: `review:${lens.key}`,
      phase: 'Review',
      agentType: REVIEWER,
      schema: FINDINGS_SCHEMA,
    }),
  (review, lens) =>
    parallel(
      ((review && review.findings) || []).map(
        (finding) => () =>
          agent(
            `${SCOPE}${lens.extra || ''}\nAdversarially refute this ${lens.key} finding: ${finding.file}:${finding.line} — ${finding.problem}. Re-read the code yourself. Default to real=false when the evidence is thin.`,
            {
              label: `verify:${finding.file}`,
              phase: 'Verify',
              agentType: REVIEWER,
              schema: VERDICT_SCHEMA,
            },
          ).then((verdict) => ({ ...finding, lens: lens.key, verdict })),
      ),
    ),
)

const confirmed = results
  .filter(Boolean)
  .flat()
  .filter(Boolean)
  .filter((finding) => finding.verdict && finding.verdict.real)
log(`${confirmed.length} confirmed findings`)
return {
  confirmed,
  summary: confirmed.length
    ? confirmed.map((finding) => `${finding.file}:${finding.line} [${finding.severity}/${finding.lens}] ${finding.problem} — fix: ${finding.fix}`).join('\n')
    : 'REVIEW: clean',
}
