---
name: migrate
description: Convert legacy 4-file dossiers (PLAN+SPEC+AUDIT+closeout/) to single-file DOSSIER.md. Invoke when the user says "ds:migrate", "migrate dossiers", "convert legacy dossier", "migrate from ck/cavekit/SPEC.md", or after installing the plugin to upgrade existing repos.
argument-hint: '[<repo-path> | --all | --gc]'
---

# ds:migrate — legacy → v2 dossier conversion

Walks repos carrying a legacy `.scratchpad/dossier/` (PLAN+SPEC+AUDIT layout). One `dossier-scout` per repo, in parallel, inspects the shape and derives content; the skill synthesises a single-file DOSSIER.md; the operator greenlights per repo. Mutation follows approval.

## Inputs

- `<repo-path>`: single repo override.
- `--all`: walk a known/configured list of repos (operator provides it at first run).
- `--from-ck [<repo-path>]`: convert a cavekit (`ck`) root `SPEC.md` into a DOSSIER.md — see **From cavekit** below. ck shares the §G/§C/§I/§V/§T/§B schema, so it is a near-1:1 lift.
- `--gc`: cleanup pass — move orphan legacy files to `_archive/_legacy-pre-v2/` for already-migrated repos.

## From cavekit (ck)

`--from-ck` lifts a `SPEC.md` (cavekit's single-file spec at repo root) into a dossier. The section schema is shared, so the map is near-1:1:

| ck `SPEC.md`                | dossier `DOSSIER.md`                                        |
| --------------------------- | ----------------------------------------------------------- |
| §G / §C / §I / §V / §T / §B | same sections, copied verbatim                              |
| (no header state line)      | add `` `<date>` · `live` · `P1/1` `` — §T carries no phases |
| (no §X)                     | seed §X from repos the spec touches (ask operator)          |
| (no §S)                     | seed one line: `ds:migrate — from-ck SPEC.md`               |
| (no §Z)                     | empty (written by `ds:close`)                               |

Flow: scout reads `SPEC.md` → propose DOSSIER.md at `.scratchpad/dossier/<date>-<slug>/` (slug from the spec title or the operator) → operator greenlights → atomic Write → regen INDEX → drop the `.migrate-v2-done` marker. The original `SPEC.md` stays where it is, for the operator to delete when satisfied. Idempotent via the same marker.

## Steps

### 0. Detect host env

Per ADAPTERS.md. `Workflow` is high-leverage here (parallel scout dispatch, §workflow).

### 1. Gather targets

`<repo-path>` given → list = \[<repo-path>\].

`--all`:

- Ask the operator for the repos to migrate. The list stays out of the plugin, which is shareable.
- Each repo: absolute path.
- Cache the list to `.scratchpad/.migrate-targets` (operator-local, gitignored) for resume.

`--gc`: walk repos where the marker exists, find orphan legacy files, archive them.

### 2. Per-repo marker check

For each target repo:

```
marker=<repo>/.scratchpad/.migrate-v2-done
```

Marker present → skip, printing `<repo>: skip (migrated <timestamp>)`.

### 3. Spawn scouts (parallel)

For each unmigrated repo, spawn `dossier-scout` with the mission:

```
You are a dossier-scout. Inspect <repo-path>/.scratchpad/dossier/.

Detect files present (PLAN.md, SPEC.md, AUDIT.md, closeout/*.md, others).
Derive:
1. <date>: prefer closeout/*.md filename pattern (YYYY-MM-DD-*), else PLAN mtime, else AUDIT mtime.
2. <slug>: prefer closeout filename slug, else first §G heading from PLAN, else dir-name.
3. Phase groupings: any "Phase N" / "G1,G2,G3" shorthand in PLAN/SPEC/closeout,
   reported as the ORDERED LIST OF TASK IDS in each group — not a count. There is
   no phase column to migrate into (FORMAT.md §8: "Phases are gone"), so the groups
   are only raw material for `needs` edges in step 4.
4. Section map: which legacy file holds which DOSSIER.md section.
   - §G ← PLAN §G or first goal-like heading
   - §C ← PLAN constraints / locked decisions
   - §I ← SPEC §I or interface section
   - §V ← SPEC §V or invariants table
   - §T ← PLAN §T or task table, re-shaped to the current header
     `| id | state | who | task | needs | cite | verify |`. Report per row:
     · id      — renumbered T1..Tn, flat and monotonic; any phase prefix dropped
     · state   — the legacy glyph, one of `. ~ x ! ?`
     · who     — `A`, or `H` when the row names an operator-only step
                 (ops review, credential, manual approval, physical access)
     · needs   — the row's own stated dependency; failing that, for the FIRST row
                 of each phase group from item 3, the LAST id of the group before
                 it; otherwise `—`
     · cite    — legacy commit/PR ref, else `—`
     · verify  — legacy verify/test cell, else `—`
   - §B ← AUDIT §B or bug ledger
   - §S ← closeout dates (synthesize timeline)
   - §Z ← closeout content (postscript)
5. Ambiguities: list anything you can't auto-derive (custom files, missing sections,
   a phase group whose ordering does not imply a real dependency, a row you cannot
   classify `A` vs `H`).

Output: caveman pipe-table report.

DO NOT MODIFY any files. Read-only.
```

Dispatch routing: repos > 2 and `Workflow` present → §workflow fan-out (ADAPTERS.md). Otherwise parallel Agent calls, one per repo.

### 4. Aggregate + propose

Per scout report, build the proposed DOSSIER.md per FORMAT.md and name the ambiguities for the operator. The header line is `` `<date>` · `live` · `P1/1` `` — all three fields, the third always the literal `P1/1`, because §T carries no phase column and the readers still need the field to match their pattern (FORMAT.md §2).

```
<repo>:
  detected: PLAN.md SPEC.md AUDIT.md closeout/phase-2-<slug>.md
  derived: date=<YYYY-MM-DD>, slug=<slug>
  section map:
    §G ← PLAN.md §1
    §C ← PLAN.md §3
    §V ← SPEC.md (12 rows)
    §T ← PLAN.md (8 rows, 6 x / 2 .; 7 who=A / 1 who=H; 3 needs edges)
    §B ← AUDIT.md (4 rows)
    §S ← synthesized from closeout dates (3 entries)
    §Z ← closeout postscript
  ambiguities:
    - "Phase G1/G2/G3" shorthand → needs edges T3←T2, T6←T5 (no phase column exists)
    - T5 "rolling restart strategy" → who=H? (names ops review)
    - 2 stray .md files: notes.md, hand-off.md → include in §S verbatim?

  proposed dest: <repo>/.scratchpad/dossier/<date>-<slug>/DOSSIER.md
  proposed move: legacy files → <repo>/.scratchpad/dossier/_archive/_legacy-pre-v2/<date>-<slug>/

  Approve? [y/n/skip]
```

**Get `needs` and `who` right here, because nothing downstream will catch them.** A migration that emits the legacy `id | P | state | task | cite | verify` header still regenerates a clean INDEX row and still exits 0 from `lib-vm-checks.sh` — the readers resolve columns by name (FORMAT.md §8) and simply find neither column, reporting nothing. The cost lands later and silently: `ds:build --next` selects the frontier as "`state=.`, every id in its `needs` cell already `x`, and `who=A`" (build/SKILL.md step 1), so a ledger with no `needs` has no edges to honour and one with no `who` cannot leave operator-only rows alone. Review these two columns per row before approving.

### 5. Per-repo mutation (on operator y)

Ordering is chosen for crash-safety:

1. **mkdir** `<repo>/.scratchpad/dossier/<date>-<slug>/`
1. **Write** `<dest>/DOSSIER.md.tmp` with the proposed content
1. **Rename** `.tmp` → `DOSSIER.md` (atomic, POSIX rename on the same FS)
1. **Write marker** `<repo>/.scratchpad/.migrate-v2-done` with an ISO timestamp
1. **Move legacy** files → `<repo>/.scratchpad/dossier/_archive/_legacy-pre-v2/<date>-<slug>/` (mkdir then mv)

Crash points:

- Between 1-3: tmp orphan or empty dir. Re-run is safe (overwrites).
- Between 3-4: new dossier exists, marker missing. Re-run redoes it idempotently.
- Between 4-5: marker says done, legacy files orphaned. `--gc` cleans them later.

### 6. Resume

Interrupted mid-batch → re-run `ds:migrate --all`. Marker-present repos skip; unmarked ones re-process.

### 7. --gc pass

For repos with the marker present: walk `<repo>/.scratchpad/dossier/` for orphan PLAN.md / SPEC.md / AUDIT.md / closeout/ and move what is found to `_archive/_legacy-pre-v2/<inferred-date-slug>/`.

Caveats:

- Missing `_archive/_legacy-pre-v2/<date-slug>/` → create it.
- Collision → append `-2`, `-3`.

### 8. Report

```
ds:migrate summary:
  migrated: <N> repos
  skipped (already done): <M>
  failed / pending operator review: <K>

per-repo:
  <repo>: <status> [<dest> | <reason>]
  ...

gc:
  cleaned <P> orphan legacy files
```

### 9. Operator-driven cleanup

Uninstalling is the operator's call. Once every target shows `done`:

- The operator deletes `.scratchpad/.migrate-targets` when they want to.
- The skill stays installed: re-runs are idempotent, and future repos may need it.

## Idempotency

- The marker is source of truth for "this repo migrated".
- Atomic writes throughout.
- Re-running is safe.
- Per-repo operator approval keeps a bulk mistake from being one keystroke.

## Cite

- FORMAT.md §1 (file location), §2 (section order), §15 (atomic writes)
- ADAPTERS.md §workflow
- agents/dossier-scout.md
