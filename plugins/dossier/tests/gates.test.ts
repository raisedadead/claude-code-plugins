import { describe, expect, test } from 'claude-code/testing'
import { type Io, editGate, skillGate, skillOf } from '../hooks/gates.ts'

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

  test('stays on when DOSSIER_MARKER_GUARD=off', async () => {
    const off = io(OPTED_IN, { env: async (name) => (name === 'DOSSIER_MARKER_GUARD' ? 'off' : undefined) })
    const verdict = await editGate(off, ROOT, { tool: 'Write', file_path: doss, content: '`2026-01-01` · `sealed` · `P1/1`' })
    expect(verdict.deny).toBeDefined()
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
