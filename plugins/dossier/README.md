# dossier

Phase-scoped engineering workflow for Claude Code. Single-file `DOSSIER.md`, resumable builds, drift detection, cross-repo state, evidence log.

Replaces the legacy 4-file pattern (`PLAN.md` + `SPEC.md` + `AUDIT.md` + `closeout/`) plus the `.scratchpad/sprints/STATUS.md` rolling-truth split. One tree, one source of truth, hook-injected on session start.

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install dossier@raisedadead-plugins
```

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

| Skill                                             | Action                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dossier:new <slug>`                             | Scaffold new dossier. Prompts for §G, §C, §X repos.                                                                                                                                                                                                        |
| `/dossier:status`                                 | Read-only dashboard. Default session-open verb. Flags incomplete ops.                                                                                                                                                                                      |
| `/dossier:build <T-id> \| --next`                 | TDD execute a §T row. Commit + §X refresh + state flip. Resumable.                                                                                                                                                                                         |
| `/dossier:check`                                  | Drift detector. Spawns scouts per repo. Reports §V / §T / §X violations.                                                                                                                                                                                   |
| `/dossier:backprop <B-id> \| <description>`       | Bug → §V protocol. Test + commit + optional invariant. Resumable.                                                                                                                                                                                          |
| `/dossier:close --complete \| --successor <slug>` | Validate, write §Z, archive. Atomic.                                                                                                                                                                                                                       |
| `/dossier:migrate`                                | Convert legacy 4-file dossiers to v2 single-file. Operator-confirmed per repo.                                                                                                                                                                             |
| `/dossier:verify [<topic>]`                       | Empirical fact-check vs primary sources. Auto-fires PreToolUse on every Write/Edit (140 EOL aliases + 34 Docker images + 31 AI models + GH Actions + k8s + 6 package ecosystems). Manual invoke = model-driven generic fact-check for any freshness claim. |
| `/dossier:roll {dump\|restore\|list}`             | Persist Claude Code TaskList across session boundaries via compact `.tlr` pipe-table. PreCompact hook auto-dumps before context shrinks.                                                                                                                   |

## Quickstart

```
# Open new wave
/dossier:new auth-cache

# Operator fills §G, §C, §X repos when prompted.

# Build tasks one by one
/dossier:build T1
/dossier:build T2

# Bug surfaces during build → backprop kicks in
/dossier:backprop "Valkey timeout cascaded to 500"

# Audit before close
/dossier:check

# Close the wave
/dossier:close --successor auth-rollout
```

## Resumability

Every multi-step op (`build`, `backprop`, `close`, `migrate`) writes a `START` line to `§S` before mutation. Each completed step appends its own line. On session loss, re-invoking the same verb auto-detects last completed step from `§S` and resumes.

Locks at `.scratchpad/dossier/<slug>/.ds-lock` prevent concurrent mutation. Stale locks (pid dead or >30min old) auto-clear on session start.

## Subagent

Plugin ships `dossier-scout` — a read-only investigator. Used by `/dossier:check` (parallel drift scans per repo) and `/dossier:migrate` (per-repo inspection). Caveman-compressed output. Refuses all writes (hard deny list on Bash patterns + tool restrictions). Spawn directly via `Agent({subagent_type: "dossier-scout", ...})` if you want a one-off read-only sweep.

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

| Adapter            | Use                                                               |
| ------------------ | ----------------------------------------------------------------- |
| `rtk` CLI          | Token compression on verbose Bash output                          |
| `context-mode` MCP | Batch reads for multi-repo scans                                  |
| `cavemem` MCP      | Cross-session memory augmentation for `ds:status` + `ds:backprop` |
| `caveman` skill    | Compressed encoding in §S + DOSSIER.md prose                      |
| `fastedit` MCP     | Surgical DOSSIER.md mutations                                     |

None required. See `ADAPTERS.md` for routing rules.

## Files

```
plugins/dossier/
├── .claude-plugin/plugin.json
├── hooks/
│   ├── hooks.json
│   ├── session-start.sh           # INDEX regen + §S tail injection
│   ├── lib-regen-index.sh         # derived INDEX from DOSSIER walk
│   ├── lib-clear-stale-locks.sh   # 30min / dead-pid auto-clear
│   ├── marker_guard.py            # PreToolUse Edit|Write|MultiEdit phase-marker blocker (exit 2)
│   ├── test_marker_guard.sh       # marker_guard smoke test
│   ├── verify_hook.py             # PreToolUse Edit|Write|MultiEdit freshness scan (non-blocking)
│   ├── verify_sweep.py            # scan existing files (used by ds:check)
│   ├── verify_lib.py              # generic check functions + HTTP cache
│   ├── verify_patterns.py         # 11 broad patterns dispatching to authorities
│   ├── verify_authorities.py      # registry: 140 EOL aliases + 31 AI models + Docker map
│   ├── roll_lib.py                # transcript parser + .tlr writer/reader
│   └── precompact-roll.py         # PreCompact auto-dump TaskList → .tlr
├── agents/
│   └── dossier-scout.md           # read-only investigator
├── skills/
│   ├── new/SKILL.md
│   ├── status/SKILL.md
│   ├── build/SKILL.md
│   ├── check/SKILL.md
│   ├── backprop/SKILL.md
│   ├── close/SKILL.md
│   ├── migrate/SKILL.md
│   ├── verify/SKILL.md            # /dossier:verify model-driven fact-check
│   └── roll/SKILL.md              # /dossier:roll {dump|restore|list}
├── FORMAT.md                      # caveman pipe-table encoding spec
├── ADAPTERS.md                    # host-env detection + routing
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

## Migration from legacy 4-file dossier

If you have a previous `.scratchpad/dossier/{PLAN,SPEC,AUDIT}.md + closeout/` layout:

```
/dossier:migrate          # walks targets you list, scouts each repo, proposes DOSSIER.md, you approve
/dossier:migrate --gc     # cleanup pass for legacy file orphans after migration
```

Idempotent. Per-repo marker `.scratchpad/.migrate-v2-done` prevents repeat.

## License

ISC License - see [LICENSE](../../LICENSE) file for details.
