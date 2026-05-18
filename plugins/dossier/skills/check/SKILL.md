---
name: check
description: Drift detector. Read-only. Diffs DOSSIER.md against code, git state, and Vm meta-invariants. Spawns dossier-scout subagents in parallel for multi-repo §V scans. Reports violations grouped by severity. Writes nothing. Invoke when the user says "ds:check", "check drift", "audit dossier", "does code still match spec", "verify invariants", or before opening a PR.
---

# ds:check — drift detector

Read-only. Validates DOSSIER.md against reality. Returns severity-tagged violation list. Never mutates.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `HAS_CTX` (parallel scout dispatch benefits).

### 1. Locate

Live dossier per `ds:status` step 1. If `--all`: also check archived dossiers (sanity sweep).

### 2. Plan scout dispatch

For each repo in §X: prepare a scout mission. Missions are **independent + parallel**.

Mission template (per scout):

```
You are a dossier-scout. Read-only.

Dossier: <path-to-DOSSIER.md> (full file pasted below)
Repo to scan: <repo-path>

Tasks:
1. For each §V row with `check` = shell predicate: run the predicate, report PASS/FAIL.
2. For each §V row with `check` = test name: locate test in <repo-path>, run if executable, report PASS/FAIL/MISSING.
3. For each §T row with state=`x` + `cite=<sha>`: verify <sha> exists in <repo-path> git log. Report VALID/MISSING.
4. Refresh §X for <repo>: git status -sb, ahead-count, latest tag, push state. Report current values; do NOT modify DOSSIER.md.

Output: caveman pipe-table. One row per finding.

<paste DOSSIER.md here>
```

Spawn one `dossier-scout` per repo, in parallel. Use Agent tool with `subagent_type: dossier-scout`.

### 2a. Verify-layer sweep (existing content)

PreToolUse `verify_hook.py` only catches new writes. Existing files may carry pre-hook claims. Scan them:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/verify_sweep.py <touched-files...>
```

Touched-files = union of files cited by any §T `x`-row commit + files in `git status -sb` (changed but uncommitted). Findings folded into 🟡 warnings (verify is advisory, never critical).

Skip if `verify_sweep.py` missing (older plugin install) — sweep is opt-in.

### 3. Local checks (main thread)

Independent of scouts. Run concurrently with dispatch:

| Vm    | Check                                                            | How                                                   |
| ----- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Vm.1  | live dossier count ≤ 1 per slug                                  | grep INDEX for duplicate slugs                        |
| Vm.2  | every §S line has ISO timestamp                                  | regex `^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}` |
| Vm.3  | every §T `x` row has non-empty `cite`                            | awk §T table                                          |
| Vm.4  | closed dossiers under `_archive/`                                | ls live dirs for §Z presence                          |
| Vm.5  | INDEX counts match DOSSIER §T/§B                                 | parse both, diff                                      |
| Vm.6  | no §S START without DONE for same target                         | awk pairing                                           |
| Vm.7  | INDEX regenerable (run lib-regen-index.sh, diff against current) | optional                                              |
| Vm.8  | no `.tmp` orphans                                                | find `.scratchpad/dossier/**/*.tmp`                   |
| Vm.9  | locks not stale                                                  | run lib-clear-stale-locks.sh in dry mode              |
| Vm.10 | migrate markers consistent (if migration in progress)            | n/a unless ds:migrate active                          |

### 4. Aggregate

Collect:

- Scout reports (one per repo).
- Local Vm findings.

Group by severity:

| Severity    | Examples                                                                           |
| ----------- | ---------------------------------------------------------------------------------- |
| 🔴 critical | §V failing + commit cited (spec lies); §T x-row commit missing (history rewritten) |
| 🟡 warning  | §X stale (>1 day); Vm.6 incomplete op; §V test MISSING (untestable claim)          |
| 🟢 info     | §X mtime close to current (refresh anyway); INDEX count off by 1                   |

### 5. Report

```
ds:check <slug>: <N> critical, <M> warnings, <K> info

🔴 critical
  <repo>: <finding>
  <repo>: <finding>

🟡 warnings
  ...

🟢 info
  ...

Vm summary:
  Vm.1 ✓ Vm.2 ✓ Vm.3 ✗ (2 rows) Vm.4 ✓ ...

Suggested remediations (do NOT auto-apply):
  - <T-id> cite=<sha> missing → ds:backprop or rebase
  - §X <repo> stale → ds:build --next (refresh as side-effect)
  - §V.<N> test MISSING → ds:backprop B<N>
```

### 6. No mutations

`ds:check` does NOT write to DOSSIER.md, INDEX.md, or any repo. Period.

Append §S? No. Read-only verb. Skipping §S keeps the log noise-free.

Exception: if `lib-regen-index.sh` is run as part of Vm.7 dry-check, that's a derived-state regen (idempotent, not a mutation per Vm.7).

## Failure handling

- Scout timeout / refuse: report scout-failed for that repo. Other scouts still proceed.
- Repo missing: flag in report, do not error.
- DOSSIER.md missing: refuse w/ "no live dossier".

## Cite

- FORMAT.md §17 (Vm rules)
- ADAPTERS.md §context-mode
- agents/dossier-scout.md (subagent contract)
