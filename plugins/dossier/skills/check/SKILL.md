---
name: check
description: Drift detector. Mutates no DOSSIER.md and no repo; it writes only derived caches. Invoke when the user says "ds:check", "check drift", "audit dossier", "does code still match spec", "verify invariants", or before opening a PR.
disallowed-tools: Edit, Write, NotebookEdit
---

# ds:check — drift detector

Validates DOSSIER.md against reality and returns a severity-tagged violation list. It changes no DOSSIER.md content and no repo. Two derived paths are written: `INDEX.md`, which `lib-ds-check.sh` regenerates on every run (step 3), and `.scratchpad/.verify-cache/`, which `verify_sweep.py` populates at step 2a through `verify_lib.cache_dir()`. Both are caches rebuilt from source, never source themselves — the carve-out step 6 states.

## Steps

### 0. Detect host env

Per ADAPTERS.md. Note `Workflow` tool presence (scout fan-out routing, §workflow).

### 1. Locate

Live dossier per `ds:status` step 1. `--all` adds archived dossiers as a sanity sweep.

### 2. Plan scout dispatch

One scout mission per §X repo, independent and parallel.

Mission template (per scout):

```
You are a dossier-scout. Read-only.

Dossier: <path-to-DOSSIER.md> (full file pasted below)
Repo to scan: <repo-path>

Headings are dual-spelled and the pasted file may use either. A ds:new
scaffold writes the plain names (`## Invariants`, `## Tasks`, `## Repos`);
older files write the sigils (`## §V`, `## §T`, `## §X`). The §-names below
are the section, not the literal heading — match whichever the file carries.

Tasks:
1. For each Invariants (§V) row with `check` = shell predicate: run the predicate, report PASS/FAIL.
2. For each Invariants (§V) row with `check` = test name: locate test in <repo-path>, run if executable, report PASS/FAIL/MISSING.
3. For each Tasks (§T) row with state=`x` + `cite=<sha>`: verify <sha> exists in <repo-path> git log. Report VALID/MISSING.
4. Refresh Repos (§X) for <repo>: git status -sb, ahead-count, latest tag, push state. Report current values; do NOT modify DOSSIER.md.

Output: caveman pipe-table. One row per finding.

<paste DOSSIER.md here>
```

Spawn one `dossier-scout` per repo, in parallel, via the Agent tool with `subagent_type: dossier:dossier-scout`.

§X repos > 2 and `Workflow` present → route the same missions through the §workflow fan-out (ADAPTERS.md): schema-validated rows, budget-gated width, crash-resumable. Otherwise the Agent spawns above.

### 2a. Verify-layer sweep (existing content)

PreToolUse `verify_hook.py` sees new writes only, so existing files may still carry pre-hook claims. Scan them:

```bash
python3 "${CLAUDE_PLUGIN_ROOT}"/hooks/verify_sweep.py <touched-files...>
```

Touched-files = files cited by any §T `x`-row commit, unioned with files in `git status -sb` (changed but uncommitted). Findings fold into 🟡 warnings — verify is advisory.

Missing `verify_sweep.py` (older plugin install) → skip; the sweep is opt-in.

### 3. Local checks (main thread)

Independent of the scouts; run concurrently with dispatch.

**Deterministic drift gate (Vm.1 + Vm.4, code):** run `"$CLAUDE_PLUGIN_ROOT"/hooks/lib-ds-check.sh .scratchpad`. It regenerates INDEX — the single source of the header × location × §Z reconcile predicate — and exits non-zero naming every dossier whose header token, directory location and §Z closure disagree: the sealed-zombie / done-not-archived class the old heuristics missed. Non-zero exit = 🔴 critical.

**Deterministic Vm sweep (Vm.2/3/6/8/9, code):** run `"$CLAUDE_PLUGIN_ROOT"/hooks/lib-vm-checks.sh .scratchpad`. One pass over every DOSSIER.md in the tree covers §S timestamp format (Vm.2), §T `x`-rows with an empty `cite` (Vm.3), unpaired §S START/DONE (Vm.6), write-temp orphans (Vm.8) and stale locks (Vm.9, via `lib-clear-stale-locks.sh --dry-run`). Each finding line is prefixed `CRITICAL` (→ 🔴) or `WARN` (→ 🟡); non-zero exit = at least one finding. Read-only — the dry-run stale-lock probe mutates nothing.

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

Collect the scout reports (one per repo) and the local Vm findings, grouped by severity:

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

`ds:check` leaves DOSSIER.md content and every repo untouched. Two derived writes are carved out. The idempotent INDEX.md regen inside `lib-ds-check.sh` (step 3): INDEX is a cache rebuilt from the DOSSIER walk (Vm.7) rather than source of truth, so re-deriving it is the same carve-out `ds:status` has, and the Vm.7 dry-check regen falls under it. And `.scratchpad/.verify-cache/`, where step 2a's `verify_sweep.py` stores fetched freshness answers for `${DS_VERIFY_TTL:-86400}` seconds — probe with `python3 -c "import sys;sys.path.insert(0,'plugins/dossier/hooks');import verify_lib;print(verify_lib.cache_dir())"`. Deleting either costs a re-derivation, nothing more.

No §S append — this is a read-only verb, and the log stays free of the noise.

## Failure handling

- Scout timeout or refusal: report scout-failed for that repo; the other scouts continue.
- Repo missing: flag it in the report and carry on.
- DOSSIER.md missing: refuse with "no live dossier".

## Cite

- FORMAT.md §17 (Vm rules)
- ADAPTERS.md §workflow
- agents/dossier-scout.md (subagent contract)
