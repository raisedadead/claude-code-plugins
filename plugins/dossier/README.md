# dossier

Phase-scoped engineering workflow for Claude Code. Single-file `DOSSIER.md`, resumable builds, drift detection, cross-repo state, evidence log.

Replaces the legacy 4-file pattern (`PLAN.md` + `SPEC.md` + `AUDIT.md` + `closeout/`) plus the `.scratchpad/sprints/STATUS.md` rolling-truth split. One tree, one source of truth, hook-injected on session start.

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
```

Requires `python3` ≥ 3.10 on `PATH` for the marker-guard, verify, and roll hooks. Without it those three hooks no-op gracefully — no crash, but source-marker protection and freshness checks won't run. The bash helpers and SessionStart dashboard work without python.

Verify: open a project, start a new Claude Code session. If `.scratchpad/dossier/` exists, the SessionStart hook injects an INDEX + live-dossier dashboard. If not, it's silent.

## Mental model

| Concept             | What                                                                          |
| ------------------- | ----------------------------------------------------------------------------- |
| Dossier             | Phase-wave scratchpad at `.scratchpad/dossier/<YYYY-MM-DD>-<slug>/DOSSIER.md` |
| Phase (`P<N>`)      | Sub-wave within a dossier                                                     |
| Task (`T<N>`)       | Atomic unit, flat-numbered, phase-tagged in column                            |
| Bug (`B<N>`)        | Caught defect, optionally upgrades to invariant                               |
| Invariant (`V<N>`)  | Testable rule that must hold                                                  |
| Repo (`§X` row)     | Touched repository, ahead-count + tag + push state                            |
| Status entry (`§S`) | Append-only timeline line, ISO timestamped                                    |
| Closeout (`§Z`)     | Final postscript, requires `successor:` or `complete:`                        |

All dossiers chronologically sortable by directory name. INDEX.md at `.scratchpad/INDEX.md` is the auto-generated dashboard.

## Verbs

Four you actually type. The rest are auto / internal / power-user.

**Primary:**

| Skill                                                                     | Action                                                                                                                                                                                                                |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dossier:status` — the **driver** ("ds" / "sit-rep" / "what's next")     | Session-open default. Hydrates the TaskList from §T, then a **decision-first** sit-rep: next decision · blockers · just-did · next-auto. `--full` for §T/§X tables. Surfaces multi-live consolidation + resume hints. |
| `/dossier:new <slug>`                                                     | Scaffold a wave. Prompts §G/§C/§X; resolves + pins current lib versions into §C/§I.                                                                                                                                   |
| `/dossier:close --complete \| --successor <slug> \| --abandon "<reason>"` | Validate, write §Z, archive. `--abandon` drops an unfinished wave. Atomic.                                                                                                                                            |
| `/dossier:check`                                                          | Deep read-only drift audit. Scouts per repo. Reports §V/§T/§X + Vm violations.                                                                                                                                        |

**Autonomy** — drive the ledger hands-off; steer by watching the TaskList:

| Invocation                                 | Action                                                                                                                                                                                                          |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dossier:build --auto` wrapped in `/goal` | Loop over actionable §T rows to completion. Pauses only on a real decision (blocked / ambiguous / destructive / push / retries / stale-§X / budget), reason logged to §S. Never auto-pushes, never auto-closes. |

**Auto / internal / power-user** (rarely typed directly):

| Skill                                 | When                                                                                                       |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `/dossier:build <T-id> \| --next`     | The TDD engine. `--auto` drives it; invoke directly for one task. Mirrors §T ↔ TaskList.                   |
| `/dossier:backprop <B-id> \| <desc>`  | Bug → §V protocol. Auto-fires from `build` on failure; invoke for a standalone bug.                        |
| `/dossier:verify [<topic>]`           | Auto-fires as a PreToolUse hook on every write. Invoke for an ad-hoc fact-check.                           |
| `/dossier:roll {dump\|restore\|list}` | TaskList persistence. Auto-dumps on PreCompact **and** SessionEnd; invoke `restore` after a fresh session. |
| `/dossier:migrate`                    | One-time legacy 4-file → single-file conversion.                                                           |

## Quickstart

```
# Open a wave (scaffolds + pins current lib versions)
/dossier:new auth-cache
# ... fill §G / §C / §X repos, add T1..Tn ...

# Drive it hands-off — watch the TaskList; it stops only on a real decision
/goal Keep running ds:build --auto until it prints DONE or PAUSE. Stop on PAUSE.

# Anytime: decision-first sit-rep — what's the next decision?
/dossier:status            # "ds" / "where are we" / "what's next"

# Audit, then close (or pause / abandon from the sit-rep)
/dossier:check
/dossier:close --successor auth-rollout
```

One task at a time? `/dossier:build T1` or `--next`. Several live dossiers piled up? `/dossier:status` flags them and offers pause / close.

## Resumability

Every multi-step op (`build`, `backprop`, `close`, `migrate`) writes a `START` line to `§S` before mutation. Each completed step appends its own line. On session loss, re-invoking the same verb auto-detects last completed step from `§S` and resumes.

Locks at `.scratchpad/dossier/<slug>/.ds-lock` prevent concurrent mutation. Stale locks (pid dead or >30min old) auto-clear on session start.

## Subagent

Plugin ships `dossier-scout` — a read-only investigator. Used by `/dossier:check` (parallel drift scans per repo) and `/dossier:migrate` (per-repo inspection). Caveman-compressed output. Refuses all writes (hard deny list on Bash patterns + tool restrictions). Spawn directly via `Agent({subagent_type: "dossier:dossier-scout", ...})` if you want a one-off read-only sweep.

## Verify-layer

Empirical defense against knowledge-cutoff hallucination. PreToolUse hook on every `Edit | Write | MultiEdit` scans content against an **authority registry** (140 EOL aliases, 34 Docker images, 31 sunset AI models) and emits stderr reminders + `additionalContext` when a freshness claim doesn't match the primary source. **Non-blocking by design** — every match exits 0; freshness violations surface as nags, not refusals. Compare to `marker_guard.py` (see below), which exits 2 and hard-blocks. Per-session dedup. Cache at `<cwd>/.scratchpad/.verify-cache/` (24h TTL on registries, 30d on resolved SHAs).

Coverage (11 broad patterns, generic dispatcher):

| Class                       | Authority                            | Examples caught                                                           |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| Free-text language / OS EOL | endoflife.date                       | `Node 18`, `Python 3.8`, `Ubuntu 18.04`, `Ruby 2.7`, `PHP 7.4`, `Go 1.18` |
| Docker image EOL            | endoflife.date via image alias       | `FROM node:18-alpine`, `image: postgres:11`, `redis:5`                    |
| GitHub Action unpinned      | `gh api repos/.../git/refs/tags/...` | `uses: actions/checkout@v4` → resolved SHA                                |
| k8s deprecated apiVersion   | k8s deprecation guide (15-entry map) | `apiVersion: extensions/v1beta1` → networking.k8s.io/v1                   |
| npm package outdated        | npmjs registry                       | `package.json` `"react": "16.0.0"` (≥2 majors behind)                     |
| PyPI outdated               | pypi.org JSON                        | `requirements.txt` / `pyproject.toml` `django==2.2.0`                     |
| crates.io outdated          | crates.io API                        | `Cargo.toml` `serde = "0.9.0"`                                            |
| RubyGems outdated           | rubygems.org API                     | `Gemfile` `gem 'rails', '5.0'`                                            |
| Go module outdated          | proxy.golang.org                     | `go.mod` `require foo v0.1.0`                                             |
| AI model deprecated         | OpenAI / Anthropic / Google docs     | `model="gpt-3.5-turbo-0613"`, `claude-2.1`, `gemini-1.0-pro`              |

**Adding a product is pure data** — append a row to `hooks/verify_authorities.py`. No code change.

Operator escape: `# verify-skip: <ruleName>` on or near the line.

Manual invoke: `/dossier:verify [<topic>]` — model-driven generic fact-check. Classifies arbitrary claims, queries the right authority via raw JSON / `gh api` / WebSearch, prints `| Claim | Verdict | Source |` table.

`ds:check` runs a one-shot sweep on touched files via `hooks/verify_sweep.py`. Findings fold into 🟡 warnings.

Network-fault-tolerant. Offline / 5xx / cache-poison = silent skip + `verify offline: <url>` to stderr. Never blocks a write.

## Marker guard

PreToolUse hook on `Edit | Write | MultiEdit` that **blocks** edits leaking phase / stage / audit-id markers (`// Phase 1:`, `// Step N:`, `// V11 (Phase 3 / A7):`, `// PH3-B7`) into non-dossier source. Exit 2 + stderr feeds Claude. Source must stay phase-agnostic — phase tracking belongs in `DOSSIER.md §B` and `§S`.

Pass-through:

- File path under `.scratchpad/dossier/` or `.scratchpad/`.
- File named `DOSSIER.md`, `PLAN.md`, `SPEC.md`, `AUDIT.md`, `LENS.md`.
- Phase token inside a string literal (regex anchors on comment prefixes: `//`, `#`, `--`, `/*`, `*`, `<!--`, `;`).
- Non-Edit tools.

Emergency bypass: `DOSSIER_MARKER_GUARD=off`, with rationale logged in the live dossier's `§S`. Smoke test: `bash hooks/test_marker_guard.sh`.

## Host-env adapters

Plugin auto-detects + uses (graceful fallback if absent):

| Adapter         | Use                                                               |
| --------------- | ----------------------------------------------------------------- |
| `rtk` CLI       | Token compression on verbose Bash output                          |
| `Workflow` tool | Deterministic scout fan-out for >2-repo scans (native harness)    |
| `cavemem` MCP   | Cross-session memory augmentation for `ds:status` + `ds:backprop` |
| `caveman` skill | Compressed encoding in §S + DOSSIER.md prose                      |
| `fastedit` MCP  | Surgical edits to SOURCE task files (`ds:build` step 6)           |
| `context7` MCP  | Current library API docs before coding (`ds:build` PIN CHECK)     |

None required. See `ADAPTERS.md` for routing rules.

## Files

```
plugins/dossier/
├── .claude-plugin/plugin.json
├── CHANGELOG.md                   # dated change log (commit-SHA versioning mode)
├── hooks/
│   ├── hooks.json                 # SessionStart, PreToolUse, PreCompact, SessionEnd
│   ├── session-start.sh           # decision-first INDEX/§T/§X injection + multi-live systemMessage
│   ├── lib-regen-index.sh         # derived INDEX from DOSSIER walk (renders paused)
│   ├── lib-header-state.sh        # atomic header state flip (live/done/paused)
│   ├── lib-row-flip.sh            # §T/§B row state (+ cite) flip
│   ├── lib-s-append.sh            # §S append (timestamped, blank-wrapped)
│   ├── lib-x-refresh.sh           # §X repo state refresh
│   ├── lib-clear-stale-locks.sh   # 30min / dead-pid auto-clear
│   ├── marker_guard.py            # PreToolUse phase-marker blocker (exit 2)
│   ├── verify_hook.py             # PreToolUse freshness scan (non-blocking)
│   ├── verify_sweep.py            # scan existing files (used by ds:check)
│   ├── verify_lib.py              # check fns + latest_version/latest_eol + HTTP cache
│   ├── verify_patterns.py         # broad patterns dispatching to authorities
│   ├── verify_authorities.py      # registry: 140 EOL aliases + 34 Docker images + 31 AI models
│   ├── resolve_pins.py            # proactive latest-version + EOL resolver (ds:new / ds:build)
│   ├── roll_lib.py                # transcript parser + .tlr writer/reader
│   ├── precompact-roll.py         # PreCompact + SessionEnd auto-dump TaskList → .tlr
│   ├── test_python.py             # stdlib tests: roll round-trip, transcript, verify offline, pins
│   ├── test_marker_guard.sh       # marker_guard smoke test
│   └── test_lib_dossier_edit.sh   # lib-*.sh helper tests (incl lib-header-state)
├── agents/
│   └── dossier-scout.md           # read-only investigator
├── skills/
│   ├── new/SKILL.md               # scaffold + clarify gate + pin-seed
│   ├── status/SKILL.md            # the driver: TaskList hydrate + decision-first sit-rep
│   ├── build/SKILL.md             # TDD engine + --auto autonomous loop
│   ├── check/SKILL.md
│   ├── backprop/SKILL.md
│   ├── close/SKILL.md             # --complete | --successor | --abandon
│   ├── migrate/SKILL.md           # legacy 4-file + --from-ck
│   ├── verify/SKILL.md            # /dossier:verify + references/authorities.md
│   └── roll/SKILL.md              # /dossier:roll {dump|restore|list}
├── FORMAT.md                      # caveman pipe-table encoding spec
├── ADAPTERS.md                    # host-env detection + routing (rtk/cavemem/caveman/fastedit/context7)
└── README.md                      # you are here
```

## Meta-invariants

`/dossier:check` validates all `Vm.*` rules from `FORMAT.md §17`:

- `Vm.1` ≤1 live dossier per slug
- `Vm.2` every §S line has ISO timestamp
- `Vm.3` every §T `x` row has commit cite
- `Vm.4` closed dossiers live under `_archive/`
- `Vm.5` INDEX counts match DOSSIER actual rows
- `Vm.6` no START without DONE for same target
- `Vm.7` INDEX regenerable from walk
- `Vm.8` atomic writes (tmp + rename)
- `Vm.9` active lock blocks mutation
- `Vm.10` migrate marker prevents repeat
- `Vm.11` resume auto-detect default
- `Vm.12` recommended ≤1 live dossier (excl. paused); >1 warns
- `Vm.13` stale-live (no §S in >14d) prompts consolidate
- `Vm.14` `--auto` PAUSE carries a reason; never auto-push/close

## Migration from legacy 4-file dossier

If you have a previous `.scratchpad/dossier/{PLAN,SPEC,AUDIT}.md + closeout/` layout:

```
/dossier:migrate          # walks targets you list, scouts each repo, proposes DOSSIER.md, you approve
/dossier:migrate --gc     # cleanup pass for legacy file orphans after migration
```

Idempotent. Per-repo marker `.scratchpad/.migrate-v2-done` prevents repeat.

## License

ISC License - see [LICENSE](../../LICENSE) file for details.
