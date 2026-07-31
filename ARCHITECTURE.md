# ARCHITECTURE.md

Living document. Read it before changing anything under `plugins/`. Update it when a decision changes — not on a schedule, and not to record activity.

Companion: [`RESEARCH.md`](./RESEARCH.md) holds the append-only record — decisions with their rejected alternatives, facts with a shelf life, open strides. This file holds what we believe now; that one holds how we got here and what is still owed.

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

| gate                            | signal                                                                | action       |
| ------------------------------- | --------------------------------------------------------------------- | ------------ |
| `slop_guard.py`                 | literal `TODO` / `FIXME` / weak-secret match — no false-positive risk | deny         |
| `marker_guard.py` header block  | non-canonical state token in a file named `DOSSIER.md`                | exit 2       |
| `marker_guard.py` advisory path | regex over comment prefixes in arbitrary source                       | exit 0, nag  |
| `verify_hook.py`                | network-dependent freshness claim                                     | never blocks |

A gate that blocks on a signal it cannot back will be disabled by the operator within a week, and then it enforces nothing at all. Overreach and absence look identical in the logs.

## Enforcement must travel with the plugin

A consumer installs `hooks/`, `skills/` and `agents/`. They never receive `.github/`. Any rule enforced only in this repo's CI is a benefit no consuming project ever gets, and measuring its value from inside this repo will overstate it — the safety net here is not present there. When a check could live in either place, prefer the hook.

## Verdict grammar

Every gate ends in one of these signals. The enforcement column is the honesty tenet made concrete — it separates what is computed from what is merely parsed. This table lives here and nowhere else; it was previously duplicated across two files with a test to keep the copies identical.

| surface             | signal                                           | enforced by              |
| ------------------- | ------------------------------------------------ | ------------------------ |
| `whetstone-doubter` | `DOUBT: FAILURES` or `NO FAILURE FOUND`          | model-judgment, parsed   |
| `dossier-reviewer`  | `REVIEW: PASS` or `CHANGES`                      | model-judgment, parsed   |
| `skill-smith` lint  | `FAIL` / `WARN` lines; exit 1 if any `FAIL`      | code — `lint_skill.py`   |
| `tdd-cycle` slice   | red, green and full-suite exit codes             | code — `run_slice.sh`    |
| `merge-resolve`     | exit 0 on marker count and pass count            | code — `verify_clean.sh` |
| `flaky-test-audit`  | per-test rate; anything between 0 and 1 is flaky | code — computed rate     |
| `ds:ship` bump      | `recommend: <BUMP>`                              | advisory; model-mapped   |

## Tenets

1. **Deterministic over discretionary.** Where a number exists, use the number. A flake is a computed rate, a clean merge is a marker count of zero, a finished slice is an exit code.
1. **Honest enforcement labels.** Every rule is tagged `code` or `model-judgment`. Parsed is not computed. `FORMAT.md` section 17 carries the ledger of these labels and is the model for the rest.
1. **Ceremony net-negative.** The default answer to a new operator verb is no. Research once proposed growing nine verbs to fourteen; the result was four.
1. **Wire, don't merge.** Composition routes, never fusion. Absent sibling means graceful skip, never a block and never an error.
1. **Assert the negative space.** Prove a gate fails when it should, not only that it passes when it should. `run_slice.sh` fails a slice whose test passes on the first run — a test that was never red proves nothing.
1. **Bound every loop.** Doubt-pass caps at three cycles. `ds:build --auto` has explicit pause classes. Any new loop states its bound.
1. **Zero technical debt.** The slop gate denies new debt markers at write time, for as long as a wave is live or paused. A problem solved in design costs less than the same problem solved in production.
1. **Extend built-ins, don't reinvent.** Claude Code ships `/review`, `/security-review`, `/simplify`. Gate them; do not rebuild them.

## Testing standard

Tests here guard hard-won invariants. They do not assert that prose says what prose says.

- **Every gate needs both a positive and a negative test.** One proving it fires, one proving it does not false-positive. TIGER_STYLE's golden rule of assertions — assert the positive space you expect, and the negative space you do not — applied to hooks.
- **Prefer one algorithm to two that agree on fixtures.** Where a predicate must exist twice, make the second a transcription of the first, not an independent implementation that happens to match. A shared fixture set only proves agreement on the cases someone thought of: the `§S` pairing predicate passed four such fixtures while still diverging on a fifth, because one side decided by set membership at the end and the other by deleting as it walked. Aligning the algorithms closed the whole class; adding fixtures would only have closed the case that was found.
- **Cross-check load-bearing predicates in two places.** If two subsystems must agree on what a value means, test that they agree — on a shared fixture, from both sides. The cautionary example is in this repo: `test_lib_regen.sh` asserts that a closeout written `complete: true.` — with the trailing period — still reads as closed, and its own failure message claims "regen/reconcile predicate parity". No matching fixture exists on the reconcile side. The test names the property it does not verify, and a reader who trusts the message inherits a false belief about coverage. A parity claim that runs against one implementation is not a cross-check.
- **A false positive becomes a permanent regression test.** `test_marker_guard.sh` carries one named inline as the artemis regression: a comment reading `# Step 1: dump the database` must not trigger the guard. It once did.
- **Never test documentation.** A grep asserting a README contains a phrase catches nothing and breaks on every edit.
- **A recorded number is a claim, and decays like one.** Counts written into a finding age badly and are rarely re-probed, so a stale one quietly becomes evidence for a conclusion it never supported. `F20` claimed ten leaked cites proving an advisory guard had failed; the real count was seven, and `git blame` put every one of them two months before the detecting pattern existed — the number was wrong and the inference it carried was backwards. Record the command beside the count, and re-run it before the count is used to justify a change.

## How this improves

The mechanism, not a wish list.

- **The ratchet.** A bug becomes an enforced invariant. `ds:backprop` root-causes a defect, decides whether an invariant would have prevented it, and mints one with a regression test. This is the primary way the suite gets better, and it is already running — the artemis regression is a worked example that predates this document.
- **Adoption order.** Native or built-in first; absorb into our own plugin second; third-party last and by default never. No new third-party plugins, no new marketplace.
- **Survey cadence.** Periodically survey the ecosystem, rank what is worth stealing, and run a corrections pass against our own findings before acting. Two such surveys are on record. The corrections pass matters more than the survey — the 2026-07-11 one overstated our Review gap and had to retract it.
- **Consolidation bias.** When research proposes more surface, the answer is usually less. Nine verbs to fourteen was proposed and became four.
- **Say why, where the hooks allow it.** TIGER_STYLE says "always motivate, always say why." Full-line comments are blocked in this rig, so the why lives in commit subjects and in `RESEARCH.md`'s decision rows instead. Two commits four minutes apart — `chore(dossier): bump 0.1.0 to 0.1.1 (force cache refresh)` then `fix(dossier): drop version pin (commit SHA = version)` — carry an entire design decision in their subject lines.

## Rationale outlives the wave

A decision is not finished when the wave that made it closes. It is finished when a later session, with none of that context, stops re-proposing the thing that was already rejected.

The worked example is this repo's own `version` field. It was removed deliberately: a version bump had been used once as a lever to force a plugin-cache refresh, and within four minutes that was recognised as the wrong lever — the commit SHA already is the version. Three weeks later a research pass, seeing a manifest with no `version` key, filed a P0 to add one back. That recommendation was not wrong given what it could see. It simply could not see the reason.

That failure repeats for free. Any future session surveying a versionless manifest will regenerate the same proposal, and the cost is paid again each time.

So the rule: **a rejected alternative is part of the decision, and must be as durable and as visible as the decision itself.** A record of what we chose is documentation. A record of what we chose *and what we turned down and why* is the only form that stops the loop.

This applies to the ledger format as much as to this repo. Constraints and rejected options currently live in a wave's own file and go quiet when it is archived — readable if you go looking, invisible if you do not, and a new session does not know to look. **The plugins do not yet close this gap.** Stated here as a deliberate commitment, tracked as an open stride in `RESEARCH.md`, and honestly labelled as unimplemented rather than described as though it works.

The shape it should take: decisions survive their wave, surface at session start alongside the sit-rep, and — where the rejected alternative is mechanically detectable — the attempt to re-adopt it is caught at write time, the way `invariant_guard.py` already catches registered invariants.

## Lineage

Named influences, sourced. Where we diverge, the divergence is stated.

| source                                                                                              | what we took                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [TigerBeetle TIGER_STYLE](https://github.com/tigerbeetle/tigerbeetle/blob/main/docs/TIGER_STYLE.md) | The declared priority ordering. Assert the negative space. Bound every loop. Zero technical debt. Limits stated as numbers. Its comment doctrine we relocate rather than reject — see above.                                                                                                                                                                                      |
| Karpathy, [Sequoia Ascent 2026](https://karpathy.bearblog.dev/sequoia-ascent-2026/) (2026-04-30)    | "Traditional computers automate what you can specify in code. This latest round of LLMs can automate what you can **verify**." The closest external statement of this suite's core bet. Same post separates raising the floor from preserving a quality bar — that distinction is the dossier/whetstone split.                                                                    |
| Karpathy, [Software 2.0](https://karpathy.medium.com/software-2-0-a64152b37c35) (2017-11-11)        | The 1.0 / 2.0 split is the precedent for labelling every rule `code` or `model-judgment`.                                                                                                                                                                                                                                                                                         |
| Karpathy, [nanochat](https://github.com/karpathy/nanochat)                                          | Two separate passages in its README: written "around one single dial of complexity", and "there are no giant configuration objects, model factories, or if-then-else monsters in the code base." Direct lineage for ceremony net-negative. [nanoGPT](https://github.com/karpathy/nanoGPT) shares the minimalism but states no such convention — the phrasing is nanochat's alone. |
| Karpathy, [Software Is Changing (Again)](https://www.youtube.com/watch?v=LCEmiRjPEtQ) (2025-06-18)  | "Less Iron Man robots, more Iron Man suits." Partial autonomy by default — `ds:build --auto` pauses on real decisions rather than running unattended.                                                                                                                                                                                                                             |
| [mattpocock/skills](https://github.com/mattpocock/skills)                                           | The facts-versus-decisions split in interview-style elicitation, which seeded `ds:grill`.                                                                                                                                                                                                                                                                                         |
| [anthropics/skills](https://github.com/anthropics/skills)                                           | First-party authoring yardstick for skill structure.                                                                                                                                                                                                                                                                                                                              |

Deliberately **not** claimed: no Karpathy lineage exists for the bug-to-invariant ratchet or for cross-session resumability. Both are original here. The 2025-02-02 "vibe coding" post is a contrast case — the thing this suite is built not to be — and his own later distinction is cited above rather than the press paraphrase of it.

## Non-goals

- **No fusion.** The two plugins stay separable.
- **No required adapters.** Every host-environment integration detects and skips. Nothing is a dependency.
- **No new operator verbs by default.** A verb must earn its place against the four that exist.
- **No cross-agent portability.** Claude Code only. Deferred deliberately, recorded as an open stride.
- **No third-party plugin dependencies.** See adoption order.
- **No version pinning.** The commit SHA is the version. See `RESEARCH.md`.
