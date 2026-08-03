---
name: ship
description: Ship-stage changelog before ds:close, derived from the §T ledger. Version bump is advisory, never an auto tag. Invoke when the user says "ds:ship", "generate the changelog", "write the changelog for this wave", "what's the version bump", or before ds:close --complete / --successor on a dossier with unreleased §T work. Do NOT use for a single mid-build commit message, and never to actually cut a tag or push.
argument-hint: '[--preview] [--changelog <path>]'
---

# ds:ship — changelog from the ledger, before the archive

Both plugin CHANGELOGs here hand-author dated wave entries; `ds:ship` mechanises that shape from §T plus git log. One file written, one recommendation printed, nothing else touched.

## Inputs

- `--preview` — allow a partial §T; print the draft to stdout and write nothing.
- `--changelog <path>` — explicit target file. Required whenever the repo holds more than one `CHANGELOG.md` (this one holds two); the operator names the target. When a wave spans plugins, repeat per target with a row subset — the split derives from each cite's touched paths and the operator confirms it.

## Steps

### 0. Detect host env

Per ADAPTERS.md.

### 1. Locate + gate

Live dossier per `ds:status`. A non-preview run requires §T all-`x` (the same scan `ds:close` uses). `--preview` skips the gate and only prints.

Changelog-target check: count `CHANGELOG.md` files in the repo (skipping `node_modules/`, `.scratchpad/`). More than one and no `--changelog` given → refuse:

```
ds:ship: <n> CHANGELOG.md files found — pass --changelog <path> (never guessing dispatch).
```

### 2. Resolve cites

For every `x` row, classify the `cite` cell first:

- SHA-shaped (`[0-9a-f]{7,40}`): verify with `git -C <repo> cat-file -t <sha>` per §X repo. A commit object resolves through `git log -1 --format=... <sha>`. Always pass the verified SHA — a bare `git log -1 <cite>` falls back to pathspec resolution and quietly resolves a wrong commit for non-SHA text.
- Anything else (artifact filename, §-ref — FORMAT.md enumerates SHA/PR-ref/`—`, and live dossiers legitimately carry artifact cites for research rows): bucket as `[no commit cite]`, entry text from the ledger's task cell. A sanctioned no-commit row is signal, not noise.
- SHA-shaped and present in no §X repo: flag `[cite unresolved]`. Every row lands somewhere.

### 3. Parse + map

Conventional-commit regex on the subject (`type(scope)!: desc`). No match → bucket under Changed, flagged `[non-conventional commit]`. Map type → bump and type → category per `reference/changelog-mapping.md` (bump table = spec; category table = convention, labelled).

### 4. Detect changelog mode

Read the target file's preamble: "Semantic Versioning" → semver mode (`## [<bumped-version>] - <date>`, `[Unreleased]` opened above); "commit-SHA versioning mode" (both in-repo CHANGELOGs) → date mode (`## <date>` + a one-line operator wave summary + range cite `[<first>..<last>]`). No changelog file → ask the operator once which mode to scaffold. Header-phrase match is a heuristic, so an ambiguous preamble routes to the operator.

### 5. Write

Group bullets under keep-a-changelog categories, omitting empty ones. Write through the atomic helper — idempotency key = the wave's range cite, unique per wave, so two waves closing the same day stay distinct under a bare date heading:

```bash
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-changelog-write.sh <changelog> <section-file> "[<first>..<last>]"
```

Exit 3 = section already present (a safe re-run). The helper is the only writer: a raw `Edit` bypasses the key and duplicates the section.

### 6. Recommend (semver mode only)

Print `recommend: <BUMP> (<n> feat, <n> fix; <BREAKING?>)` — advisory text. The bump stays text here: `git tag`, a `plugin.json` version edit and `git push` are separate operator-explicit actions (Tenet 05).

### 7. Breadcrumb

Append §S: `ds:ship — DONE changelog=<path> section=<key>`.

## Honesty labels

| claim                                       | enforced by                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------ |
| §T all-x before a non-preview run           | code — deterministic row scan                                            |
| SHA cite resolves (or is flagged)           | code-checkable (`cat-file -t` exit code); whether it ran per row = model |
| conventional-commit type parse              | code-checkable (regex); whether it was applied per row = model           |
| type → bump                                 | code — spec lookup table                                                 |
| duplicate section refused                   | code — `lib-changelog-write.sh` key grep                                 |
| type → category                             | model — convention table, judgment on refactor/removal flavor            |
| entry wording (task text vs commit subject) | model — "for humans" per keep-a-changelog                                |
| changelog-mode detection from header phrase | model — heuristic; ambiguity routes to the operator                      |
| the printed bump                            | advisory ALWAYS — never becomes a tag/version edit in this skill         |

## Anti-patterns

- Restating §T rows without consulting the cited commits — derivation is the point.
- "Changelog written" before every `x` row is categorised or explicitly flagged (`unresolved` / `non-conventional` / `no commit cite`). Checkable: flagged + categorised == total.
- Calling the bump a "computed version" — it is a recommendation.
- Forcing per-bullet SHA style onto a repo whose changelog already uses range-cite date headers.
- Folding `git tag` / `git push` / version edits into this verb.

## Cite

- FORMAT.md §8 (§T), §10 (§X), §15 (atomic writes), Vm.8
- reference/changelog-mapping.md (tables), hooks/lib-changelog-write.sh (writer)
- skills/close/SKILL.md step 5 (advisory consumer)
