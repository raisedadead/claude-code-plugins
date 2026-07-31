---
name: check
description: Drift detector. Read-only — writes nothing. Invoke when the user says "ds:check", "check drift", "audit dossier", "does code still match spec", "verify invariants", or before opening a PR.
disallowed-tools: Edit, Write, NotebookEdit
---

# ds:check — drift detector

Read-only. Validates DOSSIER.md against reality. Returns severity-tagged violation list. Never mutates.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `Workflow` tool presence (scout fan-out routing, §workflow).

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

Spawn one `dossier-scout` per repo, in parallel. Use Agent tool with `subagent_type: dossier:dossier-scout`.

§X repos > 2 AND `Workflow` tool present → route the same missions through the §workflow fan-out (ADAPTERS.md): schema-validated rows, budget-gated width, crash-resumable. Else: Agent spawns above.

### 2a. Verify-layer sweep (existing content)

PreToolUse `verify_hook.py` only catches new writes. Existing files may carry pre-hook claims. Scan them:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/verify_sweep.py <touched-files...>
```

Touched-files = union of files cited by any §T `x`-row commit + files in `git status -sb` (changed but uncommitted). Findings folded into 🟡 warnings (verify is advisory, never critical).

Skip if `verify_sweep.py` missing (older plugin install) — sweep is opt-in.

### 3. Local checks (main thread)

Independent of scouts. Run concurrently with dispatch:

**Deterministic drift gate (Vm.1 + Vm.4, enforced by code — not model discretion):** run `"$CLAUDE_PLUGIN_ROOT"/hooks/lib-ds-check.sh .scratchpad`. It regenerates INDEX (the single source of the header × location × §Z reconcile predicate) and exits non-zero, naming every dossier whose header token, directory location, and §Z closure disagree — the sealed-zombie / done-not-archived class that the old heuristics missed. Non-zero exit = 🔴 critical.

**Deterministic Vm sweep (Vm.2/3/6/8/9, enforced by code — not model discretion):** run `"$CLAUDE_PLUGIN_ROOT"/hooks/lib-vm-checks.sh .scratchpad`. One pass over every DOSSIER.md in the tree covers §S timestamp format (Vm.2), §T `x`-rows with empty `cite` (Vm.3), unpaired §S START/DONE (Vm.6), write-temp orphans (Vm.8), and stale locks (Vm.9, via `lib-clear-stale-locks.sh --dry-run`). Each finding line is prefixed `CRITICAL` (→ 🔴) or `WARN` (→ 🟡); non-zero exit = at least one finding. Read-only — the dry-run stale-lock probe mutates nothing.

| Vm    | Check                                                                    | How                                                  |
| ----- | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| Vm.1  | every live dossier reads state=live in INDEX; header⇔location concordant | `lib-ds-check.sh` (deterministic header×location×§Z) |
| Vm.2  | every §S line has ISO timestamp                                          | `lib-vm-checks.sh` (Vm.2, deterministic)             |
| Vm.3  | every §T `x` row has non-empty `cite`                                    | `lib-vm-checks.sh` (Vm.3, deterministic)             |
| Vm.4  | closed dossiers under `_archive/`                                        | `lib-ds-check.sh` (deterministic)                    |
| Vm.5  | INDEX counts match DOSSIER §T/§B                                         | parse both, diff                                     |
| Vm.6  | no §S START without DONE for same target                                 | `lib-vm-checks.sh` (Vm.6, deterministic)             |
| Vm.7  | INDEX regenerable (run lib-regen-index.sh, diff against current)         | optional                                             |
| Vm.8  | no write-temp orphans                                                    | `lib-vm-checks.sh` (Vm.8, deterministic)             |
| Vm.9  | locks not stale                                                          | `lib-vm-checks.sh` (Vm.9, deterministic)             |
| Vm.10 | migrate markers consistent (if migration in progress)                    | n/a unless ds:migrate active                         |
| Vm.12 | ≤1 live dossier (excl. paused)                                           | count INDEX rows state=live; >1 → 🟡 warn            |
| Vm.13 | no stale-live (no §S in >N days)                                         | newest §S ts per live vs `DS_STALE_LIVE_DAYS` (14)   |
| Vm.14 | every `--auto` PAUSE carries a reason class                              | grep §S `PAUSE reason=`; flag any bare PAUSE         |

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

`ds:check` writes no DOSSIER.md content and touches no repo. The sole exception is the derived, idempotent INDEX.md regen inside `lib-ds-check.sh` (step 3): INDEX is a cache rebuilt from the DOSSIER walk (Vm.7), never source of truth, so re-deriving it is not a mutation — same carve-out as `ds:status`.

Append §S? No. Read-only verb. Skipping §S keeps the log noise-free.

Exception: if `lib-regen-index.sh` is run as part of Vm.7 dry-check, that's a derived-state regen (idempotent, not a mutation per Vm.7).

## Failure handling

- Scout timeout / refuse: report scout-failed for that repo. Other scouts still proceed.
- Repo missing: flag in report, do not error.
- DOSSIER.md missing: refuse w/ "no live dossier".

## Cite

- FORMAT.md §17 (Vm rules)
- ADAPTERS.md §workflow
- agents/dossier-scout.md (subagent contract)
