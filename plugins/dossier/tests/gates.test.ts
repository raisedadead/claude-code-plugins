import { describe, expect, test } from 'claude-code/testing'
import { type Io, editGate, promptGate, sessionGate, skillGate, skillOf, stopGate, verifyGate } from '../hooks/gates.ts'

const ROOT = '/w'

function io(files: Record<string, string>, extra: Partial<Io> = {}): Io {
  return {
    isDir: async (path) => Object.keys(files).some((f) => f.startsWith(`${path}/`)),
    read: async (path) => {
      const text = files[path]
      if (text === undefined) throw new Error(`missing ${path}`)
      return text
    },
    exists: async (path) => path in files || Object.keys(files).some((f) => f.startsWith(`${path}/`)),
    list: async (path) =>
      [...new Set(Object.keys(files).filter((f) => f.startsWith(`${path}/`)).map((f) => f.slice(path.length + 1).split('/')[0] ?? ''))],
    env: async () => undefined,
    run: async () => ({ exitCode: 0, stdout: '', stderr: '' }),
    ...extra,
  }
}

const OPTED_IN = { [`${ROOT}/.scratchpad/dossier/.keep`]: '' }

function edit(file_path: string, new_string: string) {
  return { tool: 'Edit', file_path, old_string: 'x', new_string }
}

describe('marker rule', () => {
  test('denies an audit id or a dossier cite in a source comment', async () => {
    for (const line of ['// PH3-B7: known-bug guard', '# PH12-A1: invariant', '// §V26: account guard', '# §B3 fix']) {
      const verdict = await editGate(io(OPTED_IN), ROOT, edit('src/foo.ts', line))
      expect(verdict.deny).toContain('dossier marker guard')
    }
  })

  test('allows bare Phase, Stage and Step words and RFC sections', async () => {
    for (const line of ['// Phase 1: validate input', '          # Step 1: dump the database', '# Stage 3: integration', '// V11 (Phase 3 / A7): note', '// RFC 7519 §4.1.4 exp claim', '// workaround for upstream bug #1234']) {
      expect(await editGate(io(OPTED_IN), ROOT, edit('src/foo.ts', line))).toEqual({})
    }
  })

  test('exempts dossier paths and DOSSIER.md, but not a repo-root SPEC.md', async () => {
    expect(await editGate(io(OPTED_IN), ROOT, edit('.scratchpad/dossier/x/DOSSIER.md', '| B1 | PH3-B7 |'))).toEqual({})
    expect(await editGate(io(OPTED_IN), ROOT, edit(`${ROOT}/.scratchpad/dossier/x/SPEC.md`, '# §V26: legacy'))).toEqual({})
    expect((await editGate(io(OPTED_IN), ROOT, edit('SPEC.md', '# §V26: scope'))).deny).toBeDefined()
  })

  test('does nothing in a project with no dossier tree', async () => {
    expect(await editGate(io({}), ROOT, edit('src/foo.ts', '// PH3-B7'))).toEqual({})
  })

  test('DOSSIER_MARKER_GUARD=off turns the marker rule off', async () => {
    const off = io(OPTED_IN, { env: async (name) => (name === 'DOSSIER_MARKER_GUARD' ? 'off' : undefined) })
    expect(await editGate(off, ROOT, edit('src/foo.ts', '// PH3-B7'))).toEqual({})
  })
})

describe('header guard', () => {
  const doss = '.scratchpad/dossier/2026-01-01-foo/DOSSIER.md'

  test('denies a non-canonical header state token', async () => {
    const verdict = await editGate(io(OPTED_IN), ROOT, { tool: 'Write', file_path: doss, content: '`2026-01-01` · `sealed` · `P1/1`' })
    expect(verdict.deny).toContain("non-canonical header state 'sealed'")
  })

  test('DOSSIER_MARKER_GUARD=off turns the header check off', async () => {
    const off = io(OPTED_IN, { env: async (name) => (name === 'DOSSIER_MARKER_GUARD' ? 'off' : undefined) })
    const verdict = await editGate(off, ROOT, { tool: 'Write', file_path: doss, content: '`2026-01-01` · `sealed` · `P1/1`' })
    expect(verdict).toEqual({})
  })

  test('allows a canonical token and header-shaped prose', async () => {
    for (const line of ['`2026-01-01` · `live` · `P1/1`', '`lib-regen-index.sh` emits `drift!` not a live state', '- `drift!` is a derived sentinel · never a header token']) {
      expect(await editGate(io(OPTED_IN), ROOT, edit(doss, line))).toEqual({})
    }
    expect(await editGate(io(OPTED_IN), ROOT, edit('src/app.ts', '`2026-01-01` · `x` · `y`'))).toEqual({})
  })
})

describe('invariant guard', () => {
  const REGISTRY = `${ROOT}/.scratchpad/dossier/.invariant-guards.json`
  const files = { ...OPTED_IN, [REGISTRY]: '[]' }

  test('denies when cli/ds invariant-check exits 1', async () => {
    let argv: readonly string[] = []
    const gate = io(files, {
      run: async (args) => {
        argv = args
        return { exitCode: 1, stdout: 'dossier invariant guard: no eval', stderr: '' }
      },
    })
    const verdict = await editGate(gate, ROOT, edit('src/app.py', 'x = eval(y)'))
    expect(verdict.deny).toBe('dossier invariant guard: no eval')
    expect(argv.slice(2)).toEqual(['invariant-check', ROOT])
  })

  test('allows on exit 0, on any other code and on a failed run', async () => {
    for (const run of [
      async () => ({ exitCode: 0, stdout: '', stderr: '' }),
      async () => ({ exitCode: 70, stdout: 'x', stderr: '' }),
      async () => {
        throw new Error('timeout')
      },
    ]) {
      expect(await editGate(io(files, { run }), ROOT, edit('src/app.py', 'eval('))).toEqual({})
    }
  })

  test('passes the advisory of skipped patterns on exit 0', async () => {
    const gate = io(files, { run: async () => ({ exitCode: 0, stdout: 'skipped V9', stderr: '' }) })
    expect(await editGate(gate, ROOT, edit('src/app.py', 'x'))).toEqual({ context: 'skipped V9' })
  })

  test('runs nothing without a registry or with DOSSIER_INVARIANT_GUARD=off', async () => {
    let ran = false
    const run = async () => {
      ran = true
      return { exitCode: 1, stdout: 'no', stderr: '' }
    }
    await editGate(io(OPTED_IN, { run }), ROOT, edit('src/app.py', 'eval('))
    await editGate(io(files, { run, env: async (n) => (n === 'DOSSIER_INVARIANT_GUARD' ? 'off' : undefined) }), ROOT, edit('src/app.py', 'eval('))
    await editGate(io(files, { run }), ROOT, edit('.scratchpad/dossier/x/DOSSIER.md', 'eval('))
    expect(ran).toBe(false)
  })
})

describe('skill gate', () => {
  const INDEX = `${ROOT}/.scratchpad/INDEX.md`
  const LIVE = '| 2026-01-01 | foo | live | P1/1 | 1/2 | 0 | x | open |\n'
  const PAUSED = '| 2026-01-02 | bar | paused | P1/1 | 1/2 | 0 | x | open |\n'
  const LOCK = `${ROOT}/.scratchpad/dossier/2026-01-01-foo/.ds-lock`

  test('reminds a built-in review while a build is in flight', async () => {
    const files = { [INDEX]: LIVE, [LOCK]: '{"skill":"ds:build","target":"T3"}' }
    const text = await skillGate(io(files), ROOT, 'simplify', new Set())
    expect(text).toContain('live dossier build in flight (2026-01-01-foo: ds:build T3)')
  })

  test('stays silent for a built-in with no lock, and for an unlisted skill', async () => {
    expect(await skillGate(io({ [INDEX]: LIVE }), ROOT, 'simplify', new Set())).toBeUndefined()
    expect(await skillGate(io({ [INDEX]: LIVE }), ROOT, 'whetstone:unknown', new Set())).toBeUndefined()
  })

  test('reminds a whetstone skill on any live dossier, once per session', async () => {
    const seen = new Set<string>()
    expect(await skillGate(io({ [INDEX]: LIVE }), ROOT, 'whetstone:tdd-cycle', seen)).toContain('live dossier (2026-01-01-foo)')
    expect(await skillGate(io({ [INDEX]: LIVE }), ROOT, 'whetstone:tdd-cycle', seen)).toBeUndefined()
  })

  test('stays silent for a whetstone skill when no dossier is live', async () => {
    expect(await skillGate(io({ [INDEX]: PAUSED }), ROOT, 'whetstone:tdd-cycle', new Set())).toBeUndefined()
  })

  test('reads an unreadable lock as a build in flight', async () => {
    const files = { [INDEX]: LIVE, [LOCK]: '' }
    const gate = io(files, {
      read: async (path) => {
        if (path === LOCK) throw new Error('EACCES')
        return files[path as keyof typeof files] ?? ''
      },
    })
    expect(await skillGate(gate, ROOT, 'review', new Set())).toContain('live dossier build in flight (2026-01-01-foo)')
  })

  test('reads the skill name from skill, then name', () => {
    expect(skillOf({ tool: 'Skill', skill: 'simplify' })).toBe('simplify')
    expect(skillOf({ tool: 'Skill', name: 'review' })).toBe('review')
    expect(skillOf({ tool: 'Skill' })).toBe('')
  })

  test('lists paused rows at dossier:close and is silent without them', async () => {
    expect(await skillGate(io({ [INDEX]: LIVE + PAUSED }), ROOT, 'dossier:close', new Set())).toContain('1 paused dossier(s) alongside this close: 2026-01-02-bar.')
    expect(await skillGate(io({ [INDEX]: LIVE }), ROOT, 'dossier:close', new Set())).toBeUndefined()
  })
})

describe('session start', () => {
  const START = { source: 'startup', session_title: '' }

  test('maps the cli report to context, title and toast', async () => {
    const stdout = JSON.stringify({
      continue: true,
      hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: '## INDEX', sessionTitle: '2026-01-01-foo' },
      systemMessage: 'dossier live: 2026-01-01-foo',
    })
    const calls: { argv: string[]; cwd?: string }[] = []
    const run: Io['run'] = async (argv, init) => {
      calls.push({ argv, cwd: init.cwd })
      return { exitCode: 0, stdout, stderr: '' }
    }
    const verdict = await sessionGate(io(OPTED_IN, { run, cli: '/p/cli/ds' }), ROOT, START)
    expect(verdict).toEqual({ context: '## INDEX', title: '2026-01-01-foo', toast: 'dossier live: 2026-01-01-foo' })
    expect(calls).toEqual([{ argv: ['sh', '/p/cli/ds', 'session-start'], cwd: ROOT }])
  })

  test('names a missing Node.js instead of going quiet', async () => {
    const run: Io['run'] = async () => ({ exitCode: 69, stdout: '', stderr: 'ds: node 22.18+ required' })
    expect((await sessionGate(io(OPTED_IN, { run }), ROOT, START)).context).toContain('needs Node.js 22.18+')
    const rejected: Io['run'] = async () => {
      throw new Error('spawn sh ENOENT')
    }
    expect((await sessionGate(io(OPTED_IN, { run: rejected }), ROOT, START)).context).toContain('cli/ds failed')
  })

  test('spawns nothing in a project without a dossier', async () => {
    let ran = false
    const run: Io['run'] = async () => {
      ran = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    expect(await sessionGate(io({}, { run }), ROOT, START)).toEqual({})
    expect(ran).toBe(false)
  })
})

describe('prompt convergence state', () => {
  test('passes the cli lines through as context', async () => {
    const run: Io['run'] = async () => ({ exitCode: 0, stdout: 'wave demo · 2 criteria · run ds:converge for the verdict\n', stderr: '' })
    expect(await promptGate(io(OPTED_IN, { run }), ROOT)).toBe('wave demo · 2 criteria · run ds:converge for the verdict')
  })

  test('stays silent on empty output, a failure or no dossier', async () => {
    const empty: Io['run'] = async () => ({ exitCode: 0, stdout: '\n', stderr: '' })
    expect(await promptGate(io(OPTED_IN, { run: empty }), ROOT)).toBeUndefined()
    const missing: Io['run'] = async () => ({ exitCode: 69, stdout: 'x', stderr: '' })
    expect(await promptGate(io(OPTED_IN, { run: missing }), ROOT)).toBeUndefined()
    const lines: Io['run'] = async () => ({ exitCode: 0, stdout: 'wave x', stderr: '' })
    expect(await promptGate(io({}, { run: lines }), ROOT)).toBeUndefined()
  })
})

describe('fake-impl stop backstop', () => {
  const armed: Io['env'] = async (name) => (name === 'DOSSIER_FAKEIMPL_CMD' ? 'npm test' : undefined)

  test('blocks with the reason the cli prints', async () => {
    const run: Io['run'] = async () => ({ exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: 'fake-impl backstop: failed' }), stderr: '' })
    expect(await stopGate(io({}, { env: armed, run }), ROOT)).toBe('fake-impl backstop: failed')
  })

  test('allows when unset, on a pass, or when the cli cannot run', async () => {
    let ran = false
    const counting: Io['run'] = async () => {
      ran = true
      return { exitCode: 0, stdout: JSON.stringify({ decision: 'block', reason: 'x' }), stderr: '' }
    }
    expect(await stopGate(io({}, { run: counting }), ROOT)).toBeUndefined()
    expect(ran).toBe(false)
    const pass: Io['run'] = async () => ({ exitCode: 0, stdout: '', stderr: '' })
    expect(await stopGate(io({}, { env: armed, run: pass }), ROOT)).toBeUndefined()
    const timedOut: Io['run'] = async () => {
      throw new Error('timed out')
    }
    expect(await stopGate(io({}, { env: armed, run: timedOut }), ROOT)).toBeUndefined()
  })
})

describe('verify advisory', () => {
  const hits = [
    { key: 'r:a', line: '⚠ verify[r] a → b · src: u' },
    { key: 'r:c', line: '⚠ verify[r] c → d · src: u' },
  ]
  const found: Io['run'] = async () => ({ exitCode: 0, stdout: JSON.stringify(hits), stderr: '' })
  const footer = '\nsilence a rule for this write: `# verify-skip: <ruleName>` anywhere in the content.'

  test('passes the edit to the cli and returns its findings once per session', async () => {
    let sent: string[] = []
    const run: Io['run'] = async (argv, init) => {
      sent = [...argv, init.stdin]
      return found(argv, init)
    }
    const fired = new Set<string>()
    const text = await verifyGate(io(OPTED_IN, { run }), ROOT, edit('ci.yml', 'uses: a@v1'), fired)
    expect(text).toBe(`${hits[0]?.line}\n${hits[1]?.line}${footer}`)
    expect(sent.slice(-3)).toEqual(['verify-edit', ROOT, JSON.stringify({ file_path: 'ci.yml', content: 'uses: a@v1' })])
    expect(await verifyGate(io(OPTED_IN, { run: found }), ROOT, edit('ci.yml', 'uses: a@v1'), fired)).toBeUndefined()
  })

  test('stays silent outside a dossier tree, on a dossier path, on no findings or a cli failure', async () => {
    expect(await verifyGate(io({}, { run: found }), ROOT, edit('ci.yml', 'x'), new Set())).toBeUndefined()
    expect(await verifyGate(io(OPTED_IN, { run: found }), ROOT, edit('.scratchpad/dossier/x/a.yml', 'x'), new Set())).toBeUndefined()
    const none: Io['run'] = async () => ({ exitCode: 0, stdout: '', stderr: '' })
    expect(await verifyGate(io(OPTED_IN, { run: none }), ROOT, edit('ci.yml', 'x'), new Set())).toBeUndefined()
    const broken: Io['run'] = async () => ({ exitCode: 69, stdout: JSON.stringify(hits), stderr: '' })
    expect(await verifyGate(io(OPTED_IN, { run: broken }), ROOT, edit('ci.yml', 'x'), new Set())).toBeUndefined()
    const rejects: Io['run'] = async () => {
      throw new Error('no sh')
    }
    expect(await verifyGate(io(OPTED_IN, { run: rejects }), ROOT, edit('ci.yml', 'x'), new Set())).toBeUndefined()
  })
})
