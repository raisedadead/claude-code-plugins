# ARCHITECTURE.md

Living document. Read it before changing anything under `plugins/`. Update it when a decision changes — not on a schedule, and not to record activity.

Companion: [`RESEARCH.md`](./RESEARCH.md) holds decisions with their rejected alternatives, facts with a shelf life, and open strides. This file holds what we believe now; that one holds why, and what is still owed. Neither is a history — see its "Collapse, don't stack" rule.

## What this solves

An agent will happily report success it cannot demonstrate. These two plugins exist to make "done" a checkable fact rather than a claim: a wave of work is tracked in one resumable ledger, and every gate along the way ends in an exit code, a computed number, or a verdict line that is honestly labelled as a judgment.

Sole operator, many projects. Nothing here is built for a hypothetical adopter — but everything here is built to work in whatever repo it is installed into. Those are not the same constraint, and conflating them produces bad calls: a capability that helps in a consuming project is in scope, while a file left behind in that project is not. Behave everywhere; leave nothing behind.

## The pair

`dossier` drives the wave. `whetstone` is the craft applied at each gate — doubt before code, red/green during, merge-resolve on conflict, lint after authoring.

They are designed to be installed together and used together. They are also independent: either works alone, every composition route detects its sibling and skips when absent, and neither declares the other as a dependency. That independence is a hard invariant, not a nicety — `whetstone` stays independently publishable.

Composition depth, not fusion. Merging them has been proposed and rejected twice.

## Ledger model

One wave of work is one file: `.scratchpad/dossier/<date>-<slug>/DOSSIER.md`. Directory names sort chronologically; `.scratchpad/INDEX.md` is the generated dashboard across all of them.

| concept      | what it is                                                            |
| ------------ | --------------------------------------------------------------------- |
| Dossier      | A phase-wave. One file, one goal, one lifetime.                       |
| Phase        | A sub-wave inside a dossier.                                          |
| Task         | An atomic unit of work, flat-numbered and phase-tagged.               |
| Bug          | A caught defect. May be promoted to an invariant.                     |
| Invariant    | A testable rule that must hold.                                       |
| Repo         | A touched repository, with ahead-count, tag and push state.           |
| Status entry | An append-only, timestamped timeline line.                            |
| Closeout     | The final postscript. Requires a successor or an explicit completion. |

Encoding lives in [`plugins/dossier/FORMAT.md`](./plugins/dossier/FORMAT.md), which every skill reads and every writer obeys. It is compressed, pipe-tabled, append-only and written atomically — all in service of the next property.

**Resumability is structural, not best-effort.** Every multi-step operation writes a start line before it mutates anything, and a line per completed step as it goes. A session lost mid-operation is recovered by re-invoking the same verb: it reads the log, finds the last completed step, and continues. Locks guard concurrent mutation and self-clear when stale.

**Subagents run fresh and read-only.** `dossier-scout` investigates; `dossier-reviewer` reviews a staged diff before commit; `whetstone-doubter` attacks a plan before code exists. Each receives an artifact-only mission — the diff, the plan, the contract — and never the parent's reasoning. That is the whole point: an agent that never saw the justification falsifies the work instead of rationalising it. Read-only is enforced by tool grant for `whetstone-doubter` alone (`Read, Grep, Glob`). All three additionally declare `disallowedTools: Edit, Write, NotebookEdit`, which is a code-level block on the edit tools, not a prompt. `dossier-scout` and `dossier-reviewer` are also granted `Bash`, and shell redirection can write — so for those two, read-only holds in code for the edit tools and by prompt alone for `Bash`. Narrowing that grant is unclaimed work, not a property to rely on today.

## Priorities

**Honesty > Recoverability > Leverage. In that order.**

Borrowed from TigerBeetle's TIGER_STYLE, which opens by declaring "safety, performance, and developer experience. In that order." A stated ordering settles arguments before they start.

- **Honesty** — never claim enforcement we do not have. A gate that is opt-in, default-off, or advisory is not a gate; say so. A verdict parsed from a model is model-judgment, not computation; label it.
- **Recoverability** — the ledger must survive a crash, a compaction, and a lost session. Steps that buy resumability are paid for without argument.
- **Leverage** — operator output per unit of ceremony. Fewer verbs, less typing, no new operator surface without a fight.

This ordering is descriptive, not aspirational. Seven of the eight recorded conflicts in `RESEARCH.md` resolve under it. The eighth does not, which is what the next rule is for.

## Enforcement strength matches evidence strength

**Block what you can prove. Nag what you suspect. Log what you merely observed.**

Orthogonal to the ordering above — no priority ranking explains why one hook hard-denies and another never blocks. Signal quality does.

| gate                            | signal                                                 | action       |
| ------------------------------- | ------------------------------------------------------ | ------------ |
| `marker_guard.py` header block  | non-canonical state token in a file named `DOSSIER.md` | exit 2       |
| `marker_guard.py` advisory path | regex over comment prefixes in arbitrary source        | exit 0, nag  |
| `verify_hook.py`                | network-dependent freshness claim                      | never blocks |

A gate that blocks on a signal it cannot back will be disabled by the operator within a week, and then it enforces nothing at all. Overreach and absence look identical in the logs.

## Enforcement must travel with the plugin

A consumer installs `hooks/`, `skills/` and `agents/`. They never receive `.github/`. Any rule enforced only in this repo's CI is a benefit no consuming project ever gets, and measuring its value from inside this repo will overstate it — the safety net here is not present there. When a check could live in either place, prefer the hook.

## Verdict grammar

Every gate ends in one of these signals. The enforcement column is the honesty tenet made concrete — it separates what is computed from what is merely parsed. This table lives here and nowhere else; it was previously duplicated across two files with a test to keep the copies identical.

| surface             | signal                                                                          | enforced by              |
| ------------------- | ------------------------------------------------------------------------------- | ------------------------ |
| `whetstone-doubter` | `DOUBT: FAILURES` or `NO FAILURE FOUND`                                         | model-judgment, parsed   |
| `dossier-reviewer`  | `REVIEW: PASS` or `CHANGES`                                                     | model-judgment, parsed   |
| `skill-smith` lint  | `FAIL` / `WARN` lines; exit 1 if any `FAIL`                                     | code — `lint_skill.py`   |
| `tdd-cycle` slice   | red, green and full-suite exit codes                                            | code — `run_slice.sh`    |
| `merge-resolve`     | exit 0 on marker count and pass count                                           | code — `verify_clean.sh` |
| `flaky-test-audit`  | per-test rate; anything between 0 and 1 is flaky                                | code — computed rate     |
| `tiger-style` check | `TIGER: CLEAN <n> file(s)[, <m> skipped]`, `BLOCK <n>` or `NAG <n>`; exit 0/1/2 | code — `tiger_check.py`  |
| `ds:converge`       | `CONVERGE: MET <n>/<n>`, `UNMET <n> of <m>` or `PARSE — <why>`; exit 0/1/2      | code — `converge.py`     |
| `ds:ship` bump      | `recommend: <BUMP>`                                                             | advisory; model-mapped   |

## Tenets

1. **Deterministic over discretionary.** Where a number exists, use the number. A flake is a computed rate, a clean merge is a marker count of zero, a finished slice is an exit code.
1. **Honest enforcement labels.** Every rule is tagged `code` or `model-judgment`. Parsed is not computed. `FORMAT.md` section 17 carries the ledger of these labels and is the model for the rest.
1. **Ceremony net-negative.** The default answer to a new operator verb is no. Research once proposed growing nine verbs to fourteen; the result was four.
1. **Wire, don't merge.** Composition routes, never fusion. Absent sibling means graceful skip, never a block and never an error.
1. **Assert the negative space.** Prove a gate fails when it should, not only that it passes when it should. `run_slice.sh` fails a slice whose test passes on the first run — a test that was never red proves nothing.
1. **Bound every loop.** Doubt-pass caps at three cycles. `ds:build --auto` has explicit pause classes. Any new loop states its bound.
1. **Zero technical debt.** A caught bug becomes an enforced invariant, not a comment promising a fix — `ds:backprop` is the mechanism. Denying debt markers at write time is a coding standard, so it lives in the operator's harness rather than here; a plugin should not ship one person's style opinion to everyone who installs it.
1. **Extend built-ins, don't reinvent.** Claude Code ships `/review`, `/security-review`, `/simplify`. Gate them; do not rebuild them.

## Testing standard

Tests here guard hard-won invariants. They do not assert that prose says what prose says.

- **Every gate needs both a positive and a negative test.** One proving it fires, one proving it does not false-positive. TIGER_STYLE's golden rule of assertions — assert the positive space you expect, and the negative space you do not — applied to hooks.
- **Prefer one algorithm to two that agree on fixtures.** Where a predicate must exist twice, make the second a transcription of the first, not an independent implementation that happens to match. A shared fixture set only proves agreement on the cases someone thought of: the `§S` pairing predicate passed four such fixtures while still diverging on a fifth, because one side decided by set membership at the end and the other by deleting as it walked. Aligning the algorithms closed the whole class; adding fixtures would only have closed the case that was found.
- **Cross-check load-bearing predicates in two places.** Where two subsystems must agree on what a value means, test the agreement from both sides on a shared fixture. A parity claim that runs against one implementation is not a cross-check, and a failure message naming a property the test never verifies hands the next reader a false belief about coverage.
- **A false positive becomes a permanent regression test.** `test_marker_guard.sh` carries one named inline as the artemis regression: a comment reading `# Step 1: dump the database` must not trigger the guard. It once did.
- **Never test documentation.** A grep asserting a README contains a phrase catches nothing and breaks on every edit.
- **A recorded number is a claim, and decays like one.** Counts written into a finding are rarely re-probed, so a stale one quietly becomes evidence for a conclusion it never supported — `F20` carries the worked example, where both the count and the inference it drove were wrong. Record the command beside the count, and re-run it before the count justifies a change.

## How this improves

The mechanism, not a wish list.

- **The ratchet.** A bug becomes an enforced invariant. `ds:backprop` root-causes a defect, decides whether an invariant would have prevented it, and mints one with a regression test. This is the primary way the suite gets better, and it is already running — the artemis regression is a worked example that predates this document.
- **Survey cadence.** Every release re-reads the sources in [`INSPIRATIONS.md`](./INSPIRATIONS.md) and stamps each row with the date, changed or not. That file carries the adoption order, what each source gave us, and what we refused from it — the corrections pass matters more than the survey, and it has caught an overstated gap in one direction and a source mined without being credited in the other.
- **Consolidation bias.** When research proposes more surface, the answer is usually less. Nine verbs to fourteen was proposed and became four.
- **Say why, where the hooks allow it.** TIGER_STYLE says "always motivate, always say why." Full-line comments are blocked in this rig, so the why lives in commit subjects and in `RESEARCH.md`'s decision rows instead. Two commits four minutes apart — `chore(dossier): bump 0.1.0 to 0.1.1 (force cache refresh)` then `fix(dossier): drop version pin (commit SHA = version)` — carry an entire design decision in their subject lines.

## Rationale outlives the wave

A decision is finished when a later session, holding none of the context, stops re-proposing what was already rejected. **So a rejected alternative is part of the decision, and stays as durable and as visible as the decision itself.** D1 is the worked example: a versionless manifest drew a P0 to add `version` back, three weeks after the reason it was removed had gone quiet.

**The counterweight matters as much: durable is not accumulated.** That rule keeps refusals, not history. A ledger that grows a row every time someone changes their mind stops being read, and an unread ledger prevents no re-proposal at all — the same failure, reached the opposite way. A position that reverses is rewritten in place, carrying every alternative still worth refusing and dropping the ones we merely passed through. **Optimise these files to be read by someone with no memory of writing them.** Git holds the route; these files hold the destination and the roads deliberately not taken.

The ledger format has the same gap: a wave's constraints and rejected options go quiet when it is archived — readable if you go looking, invisible if you do not. **The plugins do not yet close this.** It is an open stride in `RESEARCH.md`, labelled unimplemented rather than described as though it works. The shape it wants: decisions survive their wave, surface at session start beside the sit-rep, and — where a rejected alternative is mechanically detectable — a re-adoption attempt is caught at write time, the way `invariant_guard.py` catches registered invariants.

## Lineage

[`INSPIRATIONS.md`](./INSPIRATIONS.md) — one row per source: what we took, what we refused and why, and the date we last looked. Every release stamps it, so "we are still current" carries a date instead of a feeling. It also holds the adoption order: native or built-in first, absorb second, third-party last and by default never.

## Non-goals

- **No fusion.** The two plugins stay separable.
- **No required adapters.** Every host-environment integration detects and skips. Nothing is a dependency.
- **No new operator verbs by default.** A verb must earn its place against the four that exist. The budget counts what an operator must remember; lifecycle verbs (`ds:build`, `ds:ship`, `ds:converge`) ride a stage of the wave and sit outside it — D3 holds the taxonomy.
- **No cross-agent portability.** Claude Code only. Deferred deliberately, recorded as an open stride.
- **No third-party plugin dependencies.** See adoption order.
- **No version pinning.** The commit SHA is the version. See `RESEARCH.md`.
