import { describe, expect, test } from 'claude-code/testing'
import { scanText } from '../hooks/claim-check.ts'

const FALSE_CLAIMS = `# false claims

The \`marker_guard.py\` hook blocks phase-marker leakage in every source file.

\`skill_gate.py\` enforces the review complement on every build.

A \`verify_hook.py\` run gates the commit.
`

const BACKED_CLAIMS = `# backed claims

The \`marker_guard.py\` header check blocks a non-canonical token at exit 2.

\`lint_skill.py\` enforces the frontmatter contract and exits 1 on any FAIL.

\`verify_clean.sh\` gates the merge on a marker count, returning exit 0 when clean.
`

const LABELLED_CLAIMS = `# labelled claims

\`marker_guard.py\` blocks nothing on the advisory path — it emits a nag.

\`skill_gate.py\` gates the built-in review commands, but the reminder is non-blocking and honoring it is model-judgment.

The \`--review\` flag gates a fresh-context reviewer; it is opt-in and never fires on its own.
`

const QUIET_PROSE = `# no claims at all

The ledger records a wave in one file. Phases group tasks; tasks carry a cite.

An operator decides when to push. Nothing here describes runtime behaviour.

The road was blocked by snow, and the gate stood open.

The \`doubt-pass\` gate runs before code exists, and \`ds:build\` has a doubt gate.

Two env-gated backstops ship with \`dossier\`, and the three write-time gates scope themselves.

The \`Agent\` \`tool_use\` blocks counted by \`subagent_type\` came to nine.
`

const flagged = (text: string) => scanText(text, 'doc.md')

describe('claim-check', () => {
  test('flags every unbacked claim and names its line', () => {
    const found = flagged(FALSE_CLAIMS)
    expect(found.length).toBe(3)
    expect(found[0]?.startsWith('doc.md:3: ')).toBe(true)
  })

  test('passes a claim that names an exit code', () => {
    expect(flagged(BACKED_CLAIMS)).toEqual([])
  })

  test('passes a claim that cites a source file and line', () => {
    const text = [
      'The guard denies the path (src/guard.ts:134).',
      'The `hook_config.json` rule blocks it; see `dot_pi/RIG.md:74`.',
      'The `register.ts` hook blocks once per turn, register.ts:24-31.',
      '',
    ].join('\n')
    expect(flagged(text)).toEqual([])
  })

  test('reads a long dotted token in linear time', () => {
    expect(flagged(`The hook blocks ${'a.'.repeat(100_000)}:\n`).length).toBe(1)
  })

  test('does not take a clock time or a ratio for a file and line', () => {
    const text = 'The hook blocks writes after 10:30.\n\nThe gate refuses 3:1 of the writes.\n'
    expect(flagged(text).length).toBe(2)
  })

  test('passes a claim labelled advisory, opt-in or model-judgment', () => {
    expect(flagged(LABELLED_CLAIMS)).toEqual([])
  })

  test('ignores nouns, adjectives and prose about the world', () => {
    expect(flagged(QUIET_PROSE)).toEqual([])
    expect(flagged('The operator blocks the push. A firewall denies the request.\n')).toEqual([])
  })

  test('keeps a table row whole so its evidence cell backs it', () => {
    const row = '| F1 | `disallowed-tools` enforces at the tool layer. | anthropics/claude-code#37683 |\n'
    expect(flagged(`| id | fact | source |\n| -- | ---- | ------ |\n${row}`)).toEqual([])
  })

  test('treats a shipped-machinery noun as a subject', () => {
    const text = 'Three rules the runner enforces rather than trusts:\n\nThe hook blocks a phase marker on sight.\n'
    expect(flagged(text).length).toBe(2)
  })

  test('leaves an indefinite subject alone', () => {
    const text = 'A gate that blocks on a signal it cannot back will be disabled by the operator within a week.\n'
    expect(flagged(text)).toEqual([])
  })

  test('passes a code-labelled enforcement row', () => {
    const row = '| Vm.3 | every x row has a cite | code — `lib-row-flip.sh` refuses cite-less `x` |\n'
    expect(flagged(row)).toEqual([])
  })

  test('does not let a bare judgment noun launder a claim', () => {
    const text = 'The `foo_guard.py` hook blocks a bad judgment call.\n\nThe `foo_guard.py` hook blocks a judgement error.\n'
    expect(flagged(text).length).toBe(2)
  })

  test('accepts every spelling of the model-judgment label', () => {
    for (const label of ['model-judgment', 'model judgement', 'model judgment', 'model-judgement']) {
      const text = `The \`foo_guard.py\` hook blocks the write, but honoring the reminder is ${label}.\n`
      expect(flagged(text)).toEqual([])
    }
  })

  test('cuts a long sentence to 110 characters', () => {
    const text = `The hook blocks ${'x'.repeat(200)}.\n`
    const [entry = ''] = flagged(text)
    expect(entry.length).toBe('doc.md:1: '.length + 110)
    expect(entry.endsWith('...')).toBe(true)
  })

  test('reads words, digits and spaces as Unicode', () => {
    expect(flagged('The hook café blocks the write.\n').length).toBe(1)
    expect(flagged('The hook blocks the write and exits ٢.\n')).toEqual([])
    expect(flagged('The hook blocks the write, see #١٢.\n')).toEqual([])
  })

  test('keeps a byte-order mark and splits on every Unicode line break', () => {
    expect(flagged('\ufeffThe hook blocks the write.\n')).toEqual(['doc.md:1: \ufeffThe hook blocks the write.'])
    expect(flagged('filler\u2028The hook blocks the write.\n')).toEqual(['doc.md:2: The hook blocks the write.'])
  })
})
