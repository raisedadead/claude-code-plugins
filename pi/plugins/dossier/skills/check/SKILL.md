---
name: dossier-check
description: Drift detector. Mutates no DOSSIER.md and no repo; it writes only derived caches. Invoke when the user says "ds:check", "check drift", "audit dossier", "does code still match spec", "verify invariants", or before opening a PR.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$DOSSIER_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# ds:check — drift detector

Validates DOSSIER.md against reality and returns a severity-tagged violation list. It changes no DOSSIER.md content and no repo. Two derived paths are written: `INDEX.md`, which `ds ds-check` regenerates on every run (step 3), and `.scratchpad/.verify-cache/`, which `ds verify-sweep` populates at step 2a. Both are caches rebuilt from source, never source themselves — the carve-out step 6 states.

## Steps

### 1. Locate

Live dossier per `/skill:dossier-status` step 1. `--all` adds archived dossiers as a sanity sweep.

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

Output: terse pipe-table. One row per finding.

<paste DOSSIER.md here>
```

Spawn one `dossier-scout` per repo, in parallel, via the Agent tool with `agent: dossier-scout`.

Dispatch fresh `dossier_delegate` scout calls with artifact-only missions. Validate the returned findings against the table above. This fan-out has no Workflow cache or crash-recovery promise; the dossier remains the recovery artifact.

### 2a. Verify-layer sweep (existing content)

The PreToolUse verify advisory sees new writes only, so existing files may still carry pre-hook claims. Scan them:

```bash
"$DOSSIER_PLUGIN_ROOT"/cli/ds verify-sweep <touched-files...>
```

Touched-files = files cited by any §T `x`-row commit, unioned with files in `git status -sb` (changed but uncommitted). Findings fold into 🟡 warnings — verify is advisory.

Exit 69 (no Node.js 22.18+) or 70 (internal error) → skip and name the stderr line; the sweep is opt-in.

### 3. Local checks (main thread)

Independent of the scouts; run concurrently with dispatch.

**Deterministic drift gate (Vm.1 + Vm.4, code):** run `"$DOSSIER_PLUGIN_ROOT"/cli/ds ds-check .scratchpad`. It regenerates INDEX — the single source of the header × location × §Z reconcile predicate — and exits non-zero naming every dossier whose header token, directory location and §Z closure disagree: the sealed-zombie / done-not-archived class the old heuristics missed. Exit 1 = 🔴 critical. Exit 69 (no Node.js 22.18+) or 70 (internal error) means the gate did not run: report its stderr line as the finding, not as drift.

**Deterministic Vm sweep (Vm.2/3/6/8/9, code):** run `"$DOSSIER_PLUGIN_ROOT"/cli/ds vm-checks .scratchpad`. One pass over every DOSSIER.md in the tree covers §S timestamp format (Vm.2), §T `x`-rows with an empty `cite` (Vm.3), unpaired §S START/DONE (Vm.6), write-temp orphans (Vm.8) and stale locks (Vm.9, via `ds clear-locks --dry-run`). Each finding line is prefixed `CRITICAL` (→ 🔴) or `WARN` (→ 🟡); exit 1 = at least one finding; exit 69 (no Node.js 22.18+) or 70 (internal error) means the sweep did not run, so report its stderr line as the finding. Read-only — the dry-run stale-lock probe mutates nothing.

| Vm    | Check                                                                    | How                                                |
| ----- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Vm.1  | every live dossier reads state=live in INDEX; header⇔location concordant | `ds ds-check` (deterministic header×location×§Z)   |
| Vm.2  | every §S line has ISO timestamp                                          | `ds vm-checks` (Vm.2, deterministic)               |
| Vm.3  | every §T `x` row has non-empty `cite`                                    | `ds vm-checks` (Vm.3, deterministic)               |
| Vm.4  | closed dossiers under `_archive/`                                        | `ds ds-check` (deterministic)                      |
| Vm.5  | INDEX counts match DOSSIER §T/§B                                         | parse both, diff                                   |
| Vm.6  | no §S START without DONE for same target                                 | `ds vm-checks` (Vm.6, deterministic)               |
| Vm.7  | INDEX regenerable (run ds regen-index, diff against current)             | optional                                           |
| Vm.8  | no write-temp orphans                                                    | `ds vm-checks` (Vm.8, deterministic)               |
| Vm.9  | locks not stale                                                          | `ds vm-checks` (Vm.9, deterministic)               |
| Vm.12 | ≤1 live dossier (excl. paused)                                           | count INDEX rows state=live; >1 → 🟡 warn          |
| Vm.13 | no stale-live (no §S in >N days)                                         | newest §S ts per live vs `DS_STALE_LIVE_DAYS` (14) |
| Vm.14 | every `--auto` PAUSE carries a reason class                              | grep §S `PAUSE reason=`; flag any bare PAUSE       |

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

`/skill:dossier-check` leaves DOSSIER.md content and every repo untouched. Two derived writes are carved out. The idempotent INDEX.md regen inside `ds ds-check` (step 3): INDEX is a cache rebuilt from the DOSSIER walk (Vm.7) rather than source of truth, so re-deriving it is the same carve-out `/skill:dossier-status` has, and the Vm.7 dry-check regen falls under it. And `.scratchpad/.verify-cache/`, where step 2a's `ds verify-sweep` stores fetched freshness answers for 24 hours (30 days for a resolved action SHA); when `.scratchpad/` cannot be created the cache falls back to `${TMPDIR:-/tmp}/dossier-verify-cache`. Deleting either costs a re-derivation, nothing more.

No §S append — this is a read-only verb, and the log stays free of the noise.

## Failure handling

- Scout timeout or refusal: report scout-failed for that repo; the other scouts continue.
- Repo missing: flag it in the report and carry on.
- DOSSIER.md missing: refuse with "no live dossier".

## Cite

- "$DOSSIER_PLUGIN_ROOT"/FORMAT.md §17 (Vm rules)
- ADAPTERS.md §workflow
- agents/dossier-scout.md (subagent contract)
