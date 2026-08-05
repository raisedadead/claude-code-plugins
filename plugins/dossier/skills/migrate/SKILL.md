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

| ck `SPEC.md`                | dossier `DOSSIER.md`                                  |
| --------------------------- | ----------------------------------------------------- |
| §G / §C / §I / §V / §T / §B | same sections, copied verbatim                        |
| (no header state line)      | add `` `<date>` · `live` · `P1/1` `` — §T carries no phases |
| (no §X)                     | seed §X from repos the spec touches (ask operator)    |
| (no §S)                     | seed one line: `ds:migrate — from-ck SPEC.md`         |
| (no §Z)                     | empty (written by `ds:close`)                         |

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
3. Phase count: scan PLAN/SPEC/closeout for "Phase N" mentions, count distinct.
4. Section map: which legacy file holds which DOSSIER.md section.
   - §G ← PLAN §G or first goal-like heading
   - §C ← PLAN constraints / locked decisions
   - §I ← SPEC §I or interface section
   - §V ← SPEC §V or invariants table
   - §T ← PLAN §T or task table
   - §B ← AUDIT §B or bug ledger
   - §S ← closeout dates (synthesize timeline)
   - §Z ← closeout content (postscript)
5. Ambiguities: list anything you can't auto-derive (custom files, multi-phase shorthand collisions, missing sections).

Output: caveman pipe-table report.

DO NOT MODIFY any files. Read-only.
```

Dispatch routing: repos > 2 and `Workflow` present → §workflow fan-out (ADAPTERS.md). Otherwise parallel Agent calls, one per repo.

### 4. Aggregate + propose

Per scout report, build the proposed DOSSIER.md per FORMAT.md and name the ambiguities for the operator:

```
<repo>:
  detected: PLAN.md SPEC.md AUDIT.md closeout/phase-2-<slug>.md
  derived: date=<YYYY-MM-DD>, slug=<slug>, phases=<N>
  section map:
    §G ← PLAN.md §1
    §C ← PLAN.md §3
    §V ← SPEC.md (12 rows)
    §T ← PLAN.md (8 rows, 6 x / 2 .)
    §B ← AUDIT.md (4 rows)
    §S ← synthesized from closeout dates (3 entries)
    §Z ← closeout postscript
  ambiguities:
    - "Phase G1/G2/G3" shorthand → mapping to P1/P2/P3
    - 2 stray .md files: notes.md, hand-off.md → include in §S verbatim?

  proposed dest: <repo>/.scratchpad/dossier/<date>-<slug>/DOSSIER.md
  proposed move: legacy files → <repo>/.scratchpad/dossier/_archive/_legacy-pre-v2/<date>-<slug>/

  Approve? [y/n/skip]
```

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
