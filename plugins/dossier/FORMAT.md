# FORMAT.md — Dossier encoding spec

Canonical reference for `DOSSIER.md` shape. Every `ds:*` skill reads this. Every writer obeys it.

Design goals: caveman-compressed, pipe-tables for state, append-only logs, atomic writes, resumable.

## Contents

- `1` File location + naming
- `2` DOSSIER.md section order
- `2.5` Wave contract (its own file, outside the ledger)
- `3` Caveman encoding
- `4` §G — Goal
- `5` §C — Constraints
- `6` §I — Interfaces
- `7` §V — Invariants
- `8` §T — Task ledger
- `9` §B — Bug ledger
- `10` §X — Cross-repo state
- `11` §S — Rolling status log
- `12` §Z — Closeout
- `13` INDEX.md
- `14` Locks
- `15` Atomic writes
- `16` Resume protocol
- `17` Meta-invariants (enforced by skills)

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

Headings are fixed. Order is fixed.

```markdown
# <slug>

`<YYYY-MM-DD>` · `<state>` · `P1/1`

## Goal
## Constraints
## Interfaces
## Invariants
## Tasks
## Bugs
## Repos
## Status
## Closeout
```

Readers match headings through `hooks/lib-sections.sh`, which holds one pattern per section and accepts both this spelling and the `## §G — Goal` … `## §Z — Closeout` sigils every dossier written before 2026-08-05 carries. A descriptive tail is allowed after either form. `ds:new` writes the worded spelling; nothing rewrites an existing ledger, so the sigil form stays readable indefinitely.

The third field is **required, and its value is never read**. `lib-header-state.sh`, `lib-regen-index.sh` and `lib-reconcile-state.sh` identify this line with a pattern ending in `` · `` — a two-field header does not match, so the state token becomes unreadable and `ds:close`, pause/resume and drift reconciliation all fail. They then read field two. Field three's contents are never examined: it is always `P1/1` because Tasks carries no phase column. Dropping it means relaxing those three patterns in the same commit, not deleting a spare field.

State values: `live` | `done` | `paused`. Default at `ds:new` = `live`. The header state token is flipped atomically by `lib-header-state.sh` (§15): `ds:close` sets `done`; the `ds:status` pause/resume actions toggle `live` ↔ `paused`. A `paused` dossier stays a direct child of `dossier/` (not archived — pause is reversible) and is excluded from the live-count + the SessionStart "current live" pick.

## 2.5 Wave contract (its own file, outside the ledger)

A wave's definition of done is a separate file — DOSSIER.md carries no contract heading, and the nine headings above are the whole ledger. It lives at `.dossier/<date>-<slug>.md` where the repo has opted in by creating that directory: tracked, citable as evidence, outliving the wave, and archived to `.dossier/_archive/` by `ds:close`. A repo that never opted in gets `<wave-dir>/CONTRACT.md` instead: untracked, archived with the ledger, citable by nobody — the degraded home is priced at write time rather than hidden. Resolution prefers the tracked home.

Shape: a `field | value` table carrying `consumer`, `reached-via` and `budget`, then a `## done-when` table of `id | command | expect`. Every command is backticked and every `expect` is `exit <n>`, `stdout: <substring>` or `stdout: (nothing)`. `ds:converge` runs them; prose criteria, a missing or empty `consumer`, a bare `stdout:`, and a numbered row that is not exactly `id | command | expect` are each refused at parse time (`CONVERGE: PARSE`, exit 2) rather than reaching a shell. Of the other two fields, `budget` is read by the prompt hook for its commits-spent line — in the tracked home only, since the count starts at the commit that added the contract; `reached-via` is read by no code — it is there for the reviewer.

A pipe inside a command is written `\|` so the row survives; the runner unescapes it. Tables are used rather than prose lists because prettier merges adjacent paragraphs and renumbers ordered lists, and a contract that the formatter rewrites is a contract the runner misreads.

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
- Host-env adapters (auto-detect, see §11): rtk, cavemem.
```

**Pinned toolchain (proactive verify):** `ds:new` / `ds:build` resolve current EOL/LTS via `hooks/resolve_pins.py eol:<slug>` and record the result here as a bullet, e.g. `Go 1.26 (latest stable — endoflife.date/go)`. Write the resolved version, not a remembered one — these bullets are the model's ground truth.

## 6. §I — Interfaces

API surface. Tables for endpoints, function signatures, config schemas. Drop prose.

```markdown
## §I — Interfaces

| Verb | Path                 | Body                | Returns                  |
| ---- | -------------------- | ------------------- | ------------------------ |
| GET  | /api/auth/token/{id} | —                   | `{token, ttl}` 200 / 404 |
| POST | /api/auth/token      | `{id, token, ttl?}` | 201 / 409                |

Config:
| Key              | Type   | Default                 | Notes              |
| ---------------- | ------ | ----------------------- | ------------------ |
| AUTH_CACHE_TTL_S | int    | 60                      | clamped [10, 3600] |
| VALKEY_ENDPOINT  | string | valkey.artemis.svc:6379 | k8s svc DNS        |
```

**Pinned deps (proactive verify):** when a task introduces a library, record the resolved latest from `hooks/resolve_pins.py <ecosystem>:<pkg>` here so the model and `ds:check` share one source of truth:

```markdown
Pinned deps:
| ecosystem | package                  | version | resolved   | src                             |
| --------- | ------------------------ | ------- | ---------- | ------------------------------- |
| go        | github.com/gin-gonic/gin | v1.12.0 | 2026-06-03 | proxy.golang.org/.../@latest    |
| npm       | react                    | 19.2.7  | 2026-06-03 | registry.npmjs.org/react/latest |
```

`version` keeps ecosystem-native form (go.mod needs the leading `v`; npm/PyPI/crates drop it).

## 7. §V — Invariants

Testable rules. Each row gets ID `V<N>`. Append-only via `ds:backprop`.

```markdown
## §V — Invariants

| id  | invariant                                                    | check                                               |
| --- | ------------------------------------------------------------ | --------------------------------------------------- |
| V1  | token-cache miss falls through to redis, never 500           | `TestAuthCacheFallback`                             |
| V2  | Valkey AUTH read from sops envelope, never plaintext literal | `grep -r 'VALKEY_PASS=' --include='*.go'` returns 0 |
| V3  | TTL clamped [10, 3600] before write                          | `TestTTLClamp`                                      |
```

Format rules:

- `id` = `V<N>` flat, monotonic, never reused.
- `invariant` = one-line testable claim. No prose.
- `check` = exact command, test name, or shell predicate.

## 8. §T — Task ledger

Every task in one pipe-table, ordered by id and related by `needs`.

```markdown
## §T — Task ledger

| id  | state | who | task                      | needs  | cite      | verify                 |
| --- | ----- | --- | ------------------------- | ------ | --------- | ---------------------- |
| T1  | x     | A   | scaffold auth/cache pkg   | —      | [a96987b] | `go test ./auth/cache` |
| T2  | x     | A   | wire Valkey client        | T1     | [b7c8d12] | V1                     |
| T3  | ~     | A   | TTL clamp logic           | T2     | —         | V3                     |
| T4  | .     | A   | rollout to gxy-management | T3     | —         | smoke test             |
| T5  | .     | H   | rolling restart strategy  | T3     | —         | needs ops review       |
```

Format rules:

- `id` = `T<N>` flat, monotonic, never reused across dossier lifetime.
- `state` = single char from §3 symbols.
- `who` = `A` the agent can finish it alone · `H` it needs the operator. Set when the row is written, not discovered when the run stalls, so `ds:build --auto` can select against it rather than starting a task it will have to abandon.
- `task` = imperative one-liner.
- `needs` = the ids that must reach `x` first, comma-separated, or `—`. Defaults to nothing, so a row states a dependency only where one exists.
- `cite` = commit SHA, PR ref, or `—` if no artifact yet.
- `verify` = §V reference, test name, or shell predicate.

The **frontier** is every `.` row whose `needs` are all `x`. It is derived on read, never stored, so no row goes stale by being forgotten.

Phases are gone. A `P<N>` column made the operator name the shape of the work before the work was understood, which is the pressure the Fog section exists to remove; a wave that genuinely runs in stages expresses that as `needs` edges between its first rows.

**Columns resolve by header name.** Four readers take the positions they need from the header row rather than counting cells, so both this layout and the legacy `id|P|state|task|cite|verify` one are read correctly: `lib-vm-checks.sh`, `lib-row-flip.sh`, `lib-regen-index.sh` and `session-start.sh`. A header naming no `state` column is reported by the first three — `WARN Vm.3`, a refusal at exit 1, and a stderr line respectively. `session-start.sh` emits JSON and so degrades quietly, showing no task summary. Find the converted set with `grep -l 'trim(f\[i\])' plugins/dossier/hooks/`; anything else that counts cells is still positional.

Vm.3: every row with `state=x` MUST have non-empty `cite`.

### §T ↔ TaskList projection

§T is source of truth; the Claude Code TaskList is a derived, in-session steering surface (hydrated by `ds:status`). Contract:

- **Join key** = task subject `"<T-id> <task>"`. Glyph map: `.`=pending, `~`=in_progress, `x`=completed.
- Hydrate projects rows in `{., ~}`; `!`/`?` rows are excluded (TaskList has no "blocked-on-human" status) and surface as BLOCKERS in the sit-rep. A `who=H` row is projected but reported separately, since it is takeable — just not by the agent.
- `blockedBy` is the row's own `needs` cell, mapped id to task. Derived, never inferred: the earlier rule read it off phase order, so every task in a phase blocked on the whole phase before it whether or not it depended on any of it.
- **§T → TaskList is eager** (`ds:build` mirrors at CLAIM→in_progress, FLIP→completed). **TaskList → §T is advisory only** — `ds:status` warns if a TaskList task is `completed` but its §T row lacks `x`+cite; it never auto-flips (Vm.3 needs a commit cite).

## 9. §B — Bug ledger

Caught bugs. Each row triggers §V amendment if recurrence-worthy. Append-only.

```markdown
## §B — Bug ledger

| id  | bug                            | root cause        | invariant added | fix cite  |
| --- | ------------------------------ | ----------------- | --------------- | --------- |
| B1  | TTL=0 panicked client          | no clamp on input | V3              | [a96987b] |
| B2  | Valkey timeout cascaded to 500 | no fallback path  | V1              | [b7c8d12] |
```

Format rules:

- `id` = `B<N>` flat, monotonic.
- `invariant added` = new `V<N>` row if added, or `—` if patch-only.

## 10. §X — Cross-repo state

Live table of every repo this dossier touches. Refreshed by `ds:build` + `ds:check`. Captures ahead-count, tag, push state.

```markdown
## §X — Cross-repo state

| repo               | branch          | ahead | tag        | pushed | notes                     |
| ------------------ | --------------- | ----- | ---------- | ------ | ------------------------- |
| fCC/artemis        | main            | 2     | v0.3.0-pre | no     | f87d138, dfdedb4 unpushed |
| fCC/infra          | feat/auth-cache | 5     | —          | yes    | deployment helm pending   |
| fCC-U/universe-cli | main            | 0     | v0.6.1     | yes    | clean                     |
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
- `<event>` ∈ `{START, DONE, commit=<sha>, §<X>=<status>, §X=stale-confirmed, drift=<n>, lock=<acquired|released>, paused reason=<text>, resumed, abandoned reason=<text>, PAUSE reason=<class>:<detail>, auto-stop=<reason>}`, plus the gate-outcome forms a skill emits for its own composed routes (`tiger=`, `doubt=`, `review=`, `pin=`, `conflict=`, `skill-lint=`, `verify_clean=`, `converge=`). The brace set is closed; the gate-outcome forms are not — a new composed route may add one, and `<skill>`/`<target>`/timestamp still bind.
- `paused` / `resumed` / `abandoned` are **atomic single-line** events — they emit NO `START`/`DONE` pair (pause/resume are non-resumable one-shot ops). A bare `START` for them would trip the incomplete-op detector.
- `PAUSE` (from `ds:build --auto`) carries a reason class ∈ `{blocked, ambiguous, destructive, push, retries-exhausted, review, tiger, x-stale, budget}`; if it follows a task `START` with no `DONE`, that task correctly shows as incomplete (resume needed). `auto-stop=<reason>` is a run-terminal line with target `—` (clean exhaustion / budget), not a `START`/`DONE`.
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

If `abandoned: true` (via `ds:close --abandon "<reason>"`):

```markdown
## §Z — Closeout

2026-05-14 17:30 — closed

abandoned: true

reason: superseded by valkey-native approach

summary: P1 shipped (T1–T2), P2 dropped.

key cites: [a96987b]
```

`reason:` is mandatory. An abandoned dossier archives like any closed one.

Vm.4: closed dossier MUST live under `.scratchpad/dossier/_archive/`.

Parser tolerance: `lib-regen-index.sh` matches `complete: true` / `successor: <slug>` as substring anywhere within §Z (not line-anchored) so dossiers that get joined by a formatter still parse. But writers MUST emit blank-line separation to keep §Z human-readable.

## 13. INDEX.md

Auto-maintained by hook + every `ds:*` skill. Never source-of-truth; regenerable.

```markdown
# .scratchpad index

| date       | slug              | state | P    | T     | B   | mtime            | §Z       |
| ---------- | ----------------- | ----- | ---- | ----- | --- | ---------------- | -------- |
| 2026-05-14 | auth-1            | live  | P1/2 | 2/5   | 2   | 2026-05-14 14:50 | —        |
| 2026-05-12 | artemis-staleness | done  | P3/3 | 12/12 | 4   | 2026-05-13 21:38 | →auth-1  |
| 2026-04-28 | k3s-bootstrap     | done  | P1/1 | 8/8   | 1   | 2026-04-29 09:12 | complete |
```

Sort: date desc. Live dossiers first.

`state` ∈ `live | paused | done | drift!` — reconciled from THREE witnesses (directory location, header state token, §Z closure). Concordant renders: `_archive/` + header `done` + §Z-closed ⇒ `done`; direct child + header `live` ⇒ `live`; header `paused` ⇒ `paused` (sorts after live). ANY disagreement or a non-canonical header token ⇒ `drift!` — a live-located `done`/`sealed` header, an archived `live` header, or a §Z-closed non-archived dir — never silently coerced to `live`. `drift!` sorts to the top. A trailing `<!-- drift:N slugs:... -->` comment records the count.

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

Every DOSSIER.md / INDEX.md mutation = write a unique temp beside the target (`mktemp "<file>.XXXXXX"`, so concurrent writers never share a temp) + `mv <temp> <file>` (POSIX rename, atomic on same FS).

Crash mid-write = a `<file>.XXXXXX` (or legacy `.tmp`) orphan + untouched real file. Each helper removes its own temp via an `EXIT` trap; a leftover from a hard kill is swept on the next run.

Vm.8: no skill writes a real file directly. Always tmp + rename.

### Bundled mutation helpers

Three scripts under `$CLAUDE_PLUGIN_ROOT/hooks/` own the common DOSSIER.md mutations. All atomic (tmp + rename), all ship with the plugin — always available, no adapter detection, no fastedit dependency (fastedit cannot edit `.md`; see ADAPTERS.md §fastedit).

| helper                | mutates                                                    | usage                                                       |
| --------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- |
| `lib-row-flip.sh`     | §T row `state` cell (+ optional `cite`)                    | `lib-row-flip.sh <dossier-dir> <row-id> <new-state> [cite]` |
| `lib-s-append.sh`     | §S — appends one blank-wrapped paragraph before `## §Z`    | `lib-s-append.sh <dossier-dir> "<event text>"`              |
| `lib-x-refresh.sh`    | §X row `branch`/`ahead`/`tag`/`pushed` (keeps `notes`)     | `lib-x-refresh.sh <dossier-dir> "<repo-label>" <repo-path>` |
| `lib-header-state.sh` | header `<state>` token (`live`/`done`/`paused`)            | `lib-header-state.sh <dossier-dir> <live\|done\|paused>`    |
| `lib-archive-move.sh` | dir location (→ `_archive/`) — the `ds:close` commit-point | `lib-archive-move.sh <src-dossier-dir> <archive-parent>`    |
| `lib-z-write.sh`      | §Z closeout block (`complete`/`successor`/`abandoned`)     | `lib-z-write.sh <dir> <kind> <value> "<summary>" "<cites>"` |

- `lib-s-append.sh` **prepends the timestamp itself** (honors `DS_TS_SECONDS`) and guarantees the §11 blank-line rule. Pass only the text *after* the timestamp — `ds:build T3 START`, never `2026-… ds:build T3 START`.
- `lib-row-flip.sh` matches the row by trimmed `id` cell **within §T only**, rewrites only the `state` (and optional `cite`) cells, exits non-zero if the id is absent from §T, if it matches more than one §T row, if the state is not one of `. ~ x ! ?`, if the id is a `B<N>` (§B has no state column — use `ds:backprop`), or if a `-> x` flip would leave the row without a `cite` (Vm.3).
- `lib-x-refresh.sh` matches the §X row by trimmed `repo` cell, runs the git probes against `<repo-path>`, rewrites `branch`/`ahead`/`tag`/`pushed`, leaves the operator-owned `notes` cell untouched, exits non-zero if the repo label is absent or the path is not a git repo. `ahead=no-upstream` + `pushed=no` when the branch has no `origin/` tracking ref.
- `lib-header-state.sh` rewrites only the `<state>` token on the header metadata line (the 2nd backtick-wrapped field), validates `<state>` ∈ `live|done|paused`, exits non-zero if the metadata line is absent. The sole writer of the header state — `ds:close` and the `ds:status` pause/resume actions both route through it.
- `lib-archive-move.sh` is the `ds:close` commit-point: refuses a pre-existing dest (no nested move), `mv`s `<src>` → `<archive-parent>/<basename>`, asserts the move landed (`DOSSIER.md` present at dest, source gone). Idempotent — a no-op if already archived (resume-safe). On any failure the source is left intact (exit non-zero) and callers leave `DONE` unwritten. Assumes `_archive/` is same-FS as `dossier/` (rename atomicity).

Skills prefer these over the Edit tool for §S / §T / §B mutations. Edit-tool fallback only if a helper is somehow missing.

## 16. Resume protocol

For multi-step ops (`ds:build`, `ds:backprop`, `ds:close`, `ds:migrate`):

1. Skill reads §S tail, greps for own target (e.g. `T3`).
1. Identifies last completed step from `<event>` field.
1. Picks up from next step. Idempotent — re-running completed steps is safe.

Auto-detect default. `--resume` flag is explicit override.

Pause/resume are NOT multi-step ops: they write a single atomic §S line (`paused reason=…` / `resumed`) and are exempt from this START/DONE protocol. Resuming a paused dossier (the `ds:status` resume action) un-pauses the header, then re-runs the incomplete-op scan so any mid-build `T<N> START` surfaces and resumes via the task-level protocol above.

## 17. Meta-invariants (enforced by skills)

| id    | rule                                                                                                                                                                              | enforced by                                               |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Vm.1  | every live dossier has state=live in INDEX                                                                                                                                        | code — `lib-ds-check.sh` (via regen reconcile)            |
| Vm.2  | every §S entry starts with valid ISO timestamp                                                                                                                                    | code — `lib-vm-checks.sh` awk                             |
| Vm.3  | every §T `x` row has non-empty `cite` (commit SHA / PR)                                                                                                                           | code — `lib-row-flip.sh` refuses cite-less `x`            |
| Vm.4  | every closed dossier has a `done` header and lives under `_archive/`; a machine-readable §Z key is NOT required there, so migrated legacy dossiers stay concordant                | code — `lib-ds-check.sh`                                  |
| Vm.5  | INDEX counts match DOSSIER §T/§B actual rows                                                                                                                                      | code — `lib-regen-index.sh` derives both                  |
| Vm.6  | every multi-step op emits §S START + DONE; partial = incomplete                                                                                                                   | code — `session-start.sh` resume scan; `ds:check` awk     |
| Vm.7  | INDEX derived from DOSSIER walk; regenerable; never blocks                                                                                                                        | code — `lib-regen-index.sh`                               |
| Vm.8  | all file mutations atomic (tmp + rename)                                                                                                                                          | code — bundled `lib-*.sh` helpers                         |
| Vm.9  | active lock blocks mutation; stale lock auto-clears                                                                                                                               | code — `lib-clear-stale-locks.sh`                         |
| Vm.10 | migrator per-repo marker `.scratchpad/.migrate-v2-done`                                                                                                                           | model — `ds:migrate`                                      |
| Vm.11 | multi-step ops auto-detect resume; `--resume` flag explicit                                                                                                                       | model — skill resume tables                               |
| Vm.12 | recommended ≤1 live dossier (excl. paused); >1 → `ds:status` warns (advisory, never blocks)                                                                                       | code — `session-start.sh` live-count                      |
| Vm.13 | live dossier with no §S entry in >N days (`DS_STALE_LIVE_DAYS`, default 14) = stale-live → consolidate prompt                                                                     | model — `ds:status`                                       |
| Vm.14 | every `ds:build --auto` PAUSE carries a reason class; the autonomous loop never auto-pushes and never auto-closes                                                                 | model — `ds:build --auto`                                 |
| Vm.15 | header token × location × §Z closure concordant (`done`⇔`_archive/`⇔§Z-closed; `live`\|`paused`⇔direct child⇔§Z-open) AND token ∈ {live,done,paused}; any disagreement ⇒ `drift!` | code — `lib-regen-index.sh` reconcile + `lib-ds-check.sh` |
| Vm.16 | at most one dossier per `<date>-<slug>` path, live or `_archive/`; the same slug under a different date is not detected                                                           | model — `ds:new` collision check                          |
| Vm.X  | stale §X (>30min) warns + requires operator confirm on flip                                                                                                                       | model — `ds:build` step 8a guard                          |

`ds:check` runs the **code**-enforced rules deterministically (`lib-ds-check.sh` exits non-zero on any Vm.1/Vm.4/Vm.15 drift) and applies the **model**-enforced rules best-effort on read. The `enforced by` column is the honest map: a `model` row is guidance a skill follows, not a guarantee — do not read "ds:check ran" as "every Vm holds".
