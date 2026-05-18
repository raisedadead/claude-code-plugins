# FORMAT.md — Dossier encoding spec

Canonical reference for `DOSSIER.md` shape. Every `ds:*` skill reads this. Every writer obeys it.

Design goals: caveman-compressed, pipe-tables for state, append-only logs, atomic writes, resumable.

______________________________________________________________________

## 1. File location + naming

```
.scratchpad/
├── INDEX.md                              # auto-maintained dashboard
└── dossier/
    ├── <YYYY-MM-DD>-<slug>/              # live dossier dir
    │   └── DOSSIER.md
    └── _archive/                         # post ds:close destination
        └── <YYYY-MM-DD>-<slug>/
            └── DOSSIER.md
```

- `<YYYY-MM-DD>` = creation date (operator-chosen at `ds:new`, defaults to today).
- `<slug>` = kebab-case, `<=30` chars, no spaces, no special chars.
- Same-day collision: append `-2`, `-3`, etc. (e.g. `2026-05-14-auth-1-2`).
- Lex sort = chrono sort. Always.

## 2. DOSSIER.md section order

Headings are fixed. Order is fixed. Skills parse positionally.

```markdown
# <slug>

`<YYYY-MM-DD>` · `<state>` · `<phase-current>/<phase-total>`

## §G — Goal
## §C — Constraints
## §I — Interfaces
## §V — Invariants
## §T — Task ledger
## §B — Bug ledger
## §X — Cross-repo state
## §S — Rolling status log
## §Z — Closeout
```

State values: `live` | `done` | `paused`. Default at `ds:new` = `live`.

## 3. Caveman encoding

Drop articles, hedging, pleasantries. Fragments OK. Pipe-tables for state.

Symbols:

| Symbol | Meaning                  |
| ------ | ------------------------ |
| `.`    | not started              |
| `~`    | in progress              |
| `x`    | done                     |
| `!`    | blocked / needs decision |
| `?`    | unknown / needs research |
| `→`    | leads to / depends on    |
| `…`    | elided / continued       |

Inline cite: `[a96987b]` for commit, `<repo>#PR/29` for PR, `§V.3` for invariant, `T<N>@<slug>` for cross-dossier task.

## 4. §G — Goal

One-line outcome statement. Then ≤5 bullets of scope fences (what's IN, what's NOT).

```markdown
## §G — Goal

Add Valkey-shared auth cache to artemis. Cuts redis-token RTT to <2ms p95.

Scope:
- artemis service: new auth/cache pkg, token lookup, TTL refresh
- Valkey ns: existing instance, no new infra
- NOT: universe-cli changes
- NOT: rollout to gxy-management (sep dossier)
```

## 5. §C — Constraints

Locked decisions. Replaces old "flavor / lens / runtime adapter" preamble. Folds in stack notes.

Format: bullets, one decision per line. Cite RFC / discussion where relevant.

```markdown
## §C — Constraints

- Go 1.23. No generics in public API (artemis convention).
- Valkey AUTH via sops envelope `infra-secrets/artemis/valkey-creds.enc`.
- TTL = 60s default, override via `AUTH_CACHE_TTL_S` env.
- Backward-compat: if Valkey unreachable, fall through to redis. No hard dep.
- Host-env adapters (auto-detect, see §11): rtk, context-mode, cavemem.
```

## 6. §I — Interfaces

API surface. Tables for endpoints, function signatures, config schemas. Drop prose.

```markdown
## §I — Interfaces

| Verb | Path | Body | Returns |
|------|------|------|---------|
| GET  | /api/auth/token/{id} | — | `{token, ttl}` 200 / 404 |
| POST | /api/auth/token | `{id, token, ttl?}` | 201 / 409 |

Config:
| Key | Type | Default | Notes |
|-----|------|---------|-------|
| AUTH_CACHE_TTL_S | int | 60 | clamped [10, 3600] |
| VALKEY_ENDPOINT | string | valkey.artemis.svc:6379 | k8s svc DNS |
```

## 7. §V — Invariants

Testable rules. Each row gets ID `V<N>`. Append-only via `ds:backprop`.

```markdown
## §V — Invariants

| id | invariant | check |
|----|-----------|-------|
| V1 | token-cache miss falls through to redis, never 500 | `TestAuthCacheFallback` |
| V2 | Valkey AUTH read from sops envelope, never plaintext literal | `grep -r 'VALKEY_PASS=' --include='*.go'` returns 0 |
| V3 | TTL clamped [10, 3600] before write | `TestTTLClamp` |
```

Format rules:

- `id` = `V<N>` flat, monotonic, never reused.
- `invariant` = one-line testable claim. No prose.
- `check` = exact command, test name, or shell predicate.

## 8. §T — Task ledger

Multi-phase tasks in one pipe-table. Phase column tags which `P<N>` each task belongs to.

```markdown
## §T — Task ledger

| id | P | state | task | cite | verify |
|----|---|-------|------|------|--------|
| T1 | P1 | x | scaffold auth/cache pkg | [a96987b] | `go test ./auth/cache` |
| T2 | P1 | x | wire Valkey client | [b7c8d12] | V1 |
| T3 | P1 | ~ | TTL clamp logic | — | V3 |
| T4 | P2 | . | rollout to gxy-management | — | smoke test |
| T5 | P2 | ! | rolling restart strategy | — | needs ops review |
```

Format rules:

- `id` = `T<N>` flat, monotonic, never reused across dossier lifetime.
- `P` = phase label `P<N>`. Local to dossier. No cross-dossier collision.
- `state` = single char from §3 symbols.
- `task` = imperative one-liner.
- `cite` = commit SHA, PR ref, or `—` if no artifact yet.
- `verify` = §V reference, test name, or shell predicate.

Vm.3: every row with `state=x` MUST have non-empty `cite`.

## 9. §B — Bug ledger

Caught bugs. Each row triggers §V amendment if recurrence-worthy. Append-only.

```markdown
## §B — Bug ledger

| id | bug | root cause | invariant added | fix cite |
|----|-----|------------|-----------------|----------|
| B1 | TTL=0 panicked client | no clamp on input | V3 | [a96987b] |
| B2 | Valkey timeout cascaded to 500 | no fallback path | V1 | [b7c8d12] |
```

Format rules:

- `id` = `B<N>` flat, monotonic.
- `invariant added` = new `V<N>` row if added, or `—` if patch-only.

## 10. §X — Cross-repo state

Live table of every repo this dossier touches. Refreshed by `ds:build` + `ds:check`. Captures ahead-count, tag, push state.

```markdown
## §X — Cross-repo state

| repo | branch | ahead | tag | pushed | notes |
|------|--------|-------|-----|--------|-------|
| fCC/artemis | main | 2 | v0.3.0-pre | no | f87d138, dfdedb4 unpushed |
| fCC/infra | feat/auth-cache | 5 | — | yes | deployment helm pending |
| fCC-U/universe-cli | main | 0 | v0.6.1 | yes | clean |
```

Format rules:

- `repo` = `<org>/<name>` or absolute path.
- `ahead` = `git rev-list --count origin/<branch>..HEAD`.
- `tag` = nearest tag from `git describe --tags --abbrev=0`, or `—`.
- `pushed` = `yes` if `ahead=0` on the upstream tracking ref, else `no`.
- `notes` = free-text, ≤80 chars.

Vm.X: stale §X (last refresh >30min ago) **warns** before `ds:build` task-flip. Operator confirms `y/N`. Default: refuse flip. §S records `§X=stale-confirmed` on yes.

## 11. §S — Rolling status log

Append-only timeline. Every skill op emits one or more lines. Format:

```
<YYYY-MM-DD HH:MM> <skill> <target> <event> [<detail>]
```

**Formatter-resistant rule (critical):** every §S entry MUST be its own paragraph (blank line before AND after). Without this, markdown formatters like prettier will merge consecutive lines into a single paragraph, breaking the per-line append/parse semantics and rendering §S unparseable by `lib-regen-index.sh` and `session-start.sh`. The parser tolerates joined entries (substring matching) but skill writers MUST emit blank-line-separated entries.

Examples (note the blank lines between entries):

```markdown
## §S — Rolling status log

2026-05-14 14:32 ds:new — created slug=auth-1 phase=P1

2026-05-14 14:35 ds:build T1 START

2026-05-14 14:41 ds:build T1 commit=a96987b

2026-05-14 14:41 ds:build T1 §X=refreshed artemis ahead=2

2026-05-14 14:41 ds:build T1 DONE → x

2026-05-14 14:42 ds:build T2 START

2026-05-14 14:50 ds:build T2 commit=b7c8d12

2026-05-14 14:50 ds:build T2 DONE → x

2026-05-14 15:01 ds:check — drift report: 0 violations, §X clean
```

Format rules:

- Timestamp = minute-granular `YYYY-MM-DD HH:MM`. Override to seconds via env `DS_TS_SECONDS=1` (concurrent-write disambiguation).
- `<skill>` = `ds:<verb>`.
- `<target>` = `T<N>`, `B<N>`, `V<N>`, or `—` for non-targeted ops.
- `<event>` ∈ `{START, DONE, commit=<sha>, §<X>=<status>, §X=stale-confirmed, drift=<n>, lock=<acquired|released>}`.
- `<detail>` free-text, ≤120 chars.

Vm.6: every multi-step op MUST emit `START` line before mutation, `DONE` line after final mutation. Missing `DONE` = incomplete = resume needed.

Vm.2: every §S line MUST begin with valid ISO timestamp.

## 12. §Z — Closeout

Written only at `ds:close`. Either `complete: true` OR `successor: <slug>`. Refuse close otherwise.

**Formatter-resistant rule:** same as §S — each line of §Z metadata (closed/complete/successor/summary/key cites) is its own paragraph (blank line between). Prevents prettier from joining the structured fields into a single prose paragraph and breaking the parser.

```markdown
## §Z — Closeout

2026-05-14 17:30 — closed

successor: auth-2-rollout

summary: P1 shipped (T1-T3 x), P2 deferred to next dossier per ops review.

key cites: [a96987b], [b7c8d12]
```

If `complete: true`:

```markdown
## §Z — Closeout

2026-05-14 17:30 — closed

complete: true

summary: All phases shipped. No follow-on dossier needed.

key cites: [a96987b], [b7c8d12], [c2d3e45]
```

Vm.4: closed dossier MUST live under `.scratchpad/dossier/_archive/`.

Parser tolerance: `lib-regen-index.sh` matches `complete: true` / `successor: <slug>` as substring anywhere within §Z (not line-anchored) so dossiers that get joined by a formatter still parse. But writers MUST emit blank-line separation to keep §Z human-readable.

## 13. INDEX.md

Auto-maintained by hook + every `ds:*` skill. Never source-of-truth; regenerable.

```markdown
# .scratchpad index

| date | slug | state | P | T | B | mtime | §Z |
|------|------|-------|---|---|---|-------|----|
| 2026-05-14 | auth-1 | live | P1/2 | 2/5 | 2 | 2026-05-14 14:50 | — |
| 2026-05-12 | artemis-staleness | done | P3/3 | 12/12 | 4 | 2026-05-13 21:38 | →auth-1 |
| 2026-04-28 | k3s-bootstrap | done | P1/1 | 8/8 | 1 | 2026-04-29 09:12 | complete |
```

Sort: date desc. Live dossiers first.

Vm.5: INDEX counts match DOSSIER.md §T/§B actual row counts.

## 14. Locks

Concurrent-session safety. JSON file at `.scratchpad/dossier/<slug>/.ds-lock`:

```json
{"pid": 12345, "started": "2026-05-14T14:32:07Z", "skill": "ds:build", "target": "T3"}
```

- Written before mutation, removed after.
- Stale rule: pid dead OR `started` >30min ago = auto-clear.
- Vm.9: skills MUST check lock before mutation. Refuse if active.

## 15. Atomic writes

Every DOSSIER.md / INDEX.md mutation = write `<file>.tmp` + `mv <file>.tmp <file>` (POSIX rename, atomic on same FS).

Crash mid-write = `.tmp` orphan + untouched real file. Skills clean `.tmp` orphans on next run.

Vm.8: no skill writes a real file directly. Always tmp + rename.

## 16. Resume protocol

For multi-step ops (`ds:build`, `ds:backprop`, `ds:close`, `ds:migrate`):

1. Skill reads §S tail, greps for own target (e.g. `T3`).
1. Identifies last completed step from `<event>` field.
1. Picks up from next step. Idempotent — re-running completed steps is safe.

Auto-detect default. `--resume` flag is explicit override.

## 17. Meta-invariants (enforced by skills)

| id    | rule                                                            |
| ----- | --------------------------------------------------------------- |
| Vm.1  | every live dossier has state=live in INDEX; ≤1 dossier per slug |
| Vm.2  | every §S entry starts with valid ISO timestamp                  |
| Vm.3  | every §T `x` row has non-empty `cite` (commit SHA / PR)         |
| Vm.4  | every closed dossier has §Z written + lives under `_archive/`   |
| Vm.5  | INDEX counts match DOSSIER §T/§B actual rows                    |
| Vm.6  | every multi-step op emits §S START + DONE; partial = incomplete |
| Vm.7  | INDEX derived from DOSSIER walk; regenerable; never blocks      |
| Vm.8  | all file mutations atomic (tmp + rename)                        |
| Vm.9  | active lock blocks mutation; stale lock auto-clears             |
| Vm.10 | migrator per-repo marker `.scratchpad/.migrate-v2-done`         |
| Vm.11 | multi-step ops auto-detect resume; `--resume` flag explicit     |
| Vm.X  | stale §X (>30min) warns + requires operator confirm on flip     |

`ds:check` validates all Vm rules on read.
