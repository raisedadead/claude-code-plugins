---
name: migrate
description: Convert legacy 4-file dossiers (PLAN+SPEC+AUDIT+closeout/) to single-file DOSSIER.md. Invoke when the user says "ds:migrate", "migrate dossiers", "convert legacy dossier", "migrate from ck/cavekit/SPEC.md", or after installing the plugin to upgrade existing repos.
argument-hint: [<repo-path> | --all | --gc]
---

# ds:migrate — legacy → v2 dossier conversion

Walks repos that have a legacy `.scratchpad/dossier/` (PLAN+SPEC+AUDIT layout). Spawns one `dossier-scout` per repo (parallel) to inspect shape + derive content. Synthesizes single-file DOSSIER.md. Operator reviews + greenlights per repo. Mutates only after approval.

## Inputs

- `<repo-path>`: single repo override.
- `--all`: walk a known/configured list of repos (operator provides at first run).
- `--from-ck [<repo-path>]`: convert a cavekit (`ck`) root `SPEC.md` into a DOSSIER.md — see **From cavekit** below. ck shares the §G/§C/§I/§V/§T/§B schema, so it's a near-1:1 lift.
- `--gc`: cleanup pass — move orphan legacy files to `_archive/_legacy-pre-v2/` for already-migrated repos.

## From cavekit (ck)

`--from-ck` lifts a `SPEC.md` (cavekit's single-file spec at repo root) into a dossier. ck and dossier share the section schema, so the map is near-1:1:

| ck `SPEC.md`                | dossier `DOSSIER.md`                                  |
| --------------------------- | ----------------------------------------------------- |
| §G / §C / §I / §V / §T / §B | same sections, copied verbatim                        |
| (no header state line)      | add `` `<date>` · `live` · `P1/<n>` `` from §T phases |
| (no §X)                     | seed §X from repos the spec touches (ask operator)    |
| (no §S)                     | seed one line: `ds:migrate — from-ck SPEC.md`         |
| (no §Z)                     | empty (written by `ds:close`)                         |

Flow: scout reads `SPEC.md` → propose DOSSIER.md at `.scratchpad/dossier/<date>-<slug>/` (slug from the spec title or operator) → operator greenlights → atomic Write → regen INDEX → drop the `.migrate-v2-done` marker. Leave the original `SPEC.md` in place (operator deletes when satisfied). Idempotent via the same marker.

## Steps

### 0. Detect host env

Per ADAPTERS.md. `Workflow` tool is high-leverage here (parallel scout dispatch, §workflow).

### 1. Gather targets

If `<repo-path>` given: list = \[<repo-path>\].

If `--all`:

- Prompt operator for list of repos to migrate (no embedded list — plugin is shareable, no personal config).
- Each repo: absolute path.
- Cache list to `.scratchpad/.migrate-targets` (operator-local file, gitignored) for resume.

If `--gc`: walk repos where marker exists, look for orphan legacy files, archive.

### 2. Per-repo marker check

For each target repo:

```
marker=<repo>/.scratchpad/.migrate-v2-done
```

If marker exists: skip (idempotent). Print `<repo>: skip (migrated <timestamp>)`.

### 3. Spawn scouts (parallel)

For each unmigrated repo: spawn `dossier-scout` with mission:

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

Dispatch routing: repos > 2 AND `Workflow` tool present → §workflow fan-out (ADAPTERS.md). Else parallel Agent tool calls (one per repo).

### 4. Aggregate + propose

For each scout report:

Build proposed DOSSIER.md content per FORMAT.md. Identify ambiguities for operator.

Print per-repo summary:

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

Ordering matters for crash-safety:

1. **mkdir** `<repo>/.scratchpad/dossier/<date>-<slug>/`
1. **Write** `<dest>/DOSSIER.md.tmp` w/ proposed content
1. **Rename** `.tmp` → `DOSSIER.md` (atomic, POSIX rename on same FS)
1. **Write marker** `<repo>/.scratchpad/.migrate-v2-done` w/ ISO timestamp
1. **Move legacy** files → `<repo>/.scratchpad/dossier/_archive/_legacy-pre-v2/<date>-<slug>/` (mkdir then mv)

Crash points:

- Between 1-3: tmp orphan or empty dir. Re-run safe (overwrites).
- Between 3-4: new dossier exists, marker missing. Re-run will re-do (idempotent — overwrite).
- Between 4-5: marker says done, legacy files orphan. `--gc` cleans later.

### 6. Resume

If interrupted mid-batch: re-run `ds:migrate --all`. Marker-present repos skip. Unmarked re-process.

### 7. --gc pass

For repos with marker present: walk `<repo>/.scratchpad/dossier/` for orphan PLAN.md / SPEC.md / AUDIT.md / closeout/. If found: move to `_archive/_legacy-pre-v2/<inferred-date-slug>/`.

Caveats:

- If `_archive/_legacy-pre-v2/<date-slug>/` doesn't exist: create.
- If collision: append `-2`, `-3`.

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

Plugin does NOT auto-uninstall. After all targets show `done`:

- Operator manually deletes `.scratchpad/.migrate-targets` if they want.
- Plugin migration skill stays installed (idempotent re-runs are safe; future repos may need it).

## Idempotency

- Marker = source of truth for "this repo migrated".
- Atomic writes throughout.
- Re-running is safe.
- Operator approval per repo prevents bulk mistakes.

## Cite

- FORMAT.md §1 (file location), §2 (section order), §15 (atomic writes)
- ADAPTERS.md §workflow
- agents/dossier-scout.md
