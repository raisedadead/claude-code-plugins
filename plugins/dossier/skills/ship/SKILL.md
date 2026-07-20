---
name: ship
description: Ship-stage changelog before ds:close. Derives a CHANGELOG.md section — and, in semver-tagged repos, an advisory version-bump recommendation, never an auto tag — from the §T ledger cross-referenced against each cite's real git log entry. Flags unresolvable or non-conventional cites, never drops rows silently, never pushes. Invoke when the user says "ds:ship", "generate the changelog", "write the changelog for this wave", "what's the version bump", or before ds:close --complete / --successor on a dossier with unreleased §T work. Do NOT use for a single mid-build commit message, and never to actually cut a tag or push.
argument-hint: [--preview] [--changelog <path>]
---

# ds:ship — changelog from the ledger, before the archive

Both plugin CHANGELOGs in this repo hand-author dated wave entries today; `ds:ship` mechanizes that same shape from §T + git log. Writes one file, prints one recommendation, mutates nothing else.

## Inputs

- `--preview` — allow a partial §T; print the draft to stdout, mutate NOTHING.
- `--changelog <path>` — explicit target file. REQUIRED whenever more than one `CHANGELOG.md` exists in the repo (this repo has two); the skill never guesses dispatch. Repeat per target with a row subset if the wave spans plugins — recommended split derives from each cite's touched paths, operator confirms.

## Steps

### 0. Detect host env

Per ADAPTERS.md.

### 1. Locate + gate

Live dossier per `ds:status`. Non-preview run requires §T all-`x` (same scan `ds:close` uses). `--preview` skips the gate but only prints.

Changelog-target check: count `CHANGELOG.md` files in the repo (skip `node_modules/`, `.scratchpad/`). More than one and no `--changelog` given → refuse:

```
ds:ship: <n> CHANGELOG.md files found — pass --changelog <path> (never guessing dispatch).
```

### 2. Resolve cites

For every `x` row, classify the `cite` cell first:

- Looks like a SHA (`[0-9a-f]{7,40}`): verify with `git -C <repo> cat-file -t <sha>` per §X repo — commit object → resolve subject/body via `git log -1 --format=... <sha>`. NEVER bare `git log -1 <cite>` — its pathspec fallback silently resolves a wrong commit for non-SHA text.
- Anything else (artifact filename, §-ref — FORMAT.md enumerates SHA/PR-ref/`—`, and live dossiers legitimately carry artifact cites for research rows): bucket as `[no commit cite]`, entry text comes from the ledger's task cell. A sanctioned no-commit row is not noise.
- SHA-shaped but found in no §X repo: flag `[cite unresolved]`. Never drop a row silently.

### 3. Parse + map

Conventional-commit regex on the subject (`type(scope)!: desc`). No match → bucket under Changed flagged `[non-conventional commit]`. Map type → bump and type → category per `reference/changelog-mapping.md` (bump table = spec; category table = convention, labeled).

### 4. Detect changelog mode

Read the target file's preamble: "Semantic Versioning" → semver mode (`## [<bumped-version>] - <date>`, `[Unreleased]` opened above); "commit-SHA versioning mode" (both in-repo CHANGELOGs) → date mode (`## <date>` + one-line operator wave summary + range cite `[<first>..<last>]`). No changelog file → ask the operator once which mode to scaffold. Header-phrase match is a heuristic — ambiguous preamble → ask, never guess.

### 5. Write

Group bullets under keep-a-changelog categories, omit empty ones. Write through the atomic helper — idempotency key = the wave's range cite (unique per wave; two waves closing the same day never collide on a bare date heading):

```bash
"$CLAUDE_PLUGIN_ROOT"/hooks/lib-changelog-write.sh <changelog> <section-file> "[<first>..<last>]"
```

Exit 3 = section already present (safe re-run). Never edit the changelog with a raw Edit.

### 6. Recommend (semver mode only)

Print `recommend: <BUMP> (<n> feat, <n> fix; <BREAKING?>)` — advisory text. NEVER `git tag`, NEVER a `plugin.json` version edit, NEVER `git push` (Tenet 05 applies inside this skill).

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
- "Changelog written" before every `x` row is categorized OR explicitly flagged (`unresolved` / `non-conventional` / `no commit cite`). Checkable: flagged + categorized == total.
- Calling the bump "computed version" — it is a recommendation.
- Forcing per-bullet SHA style onto a repo whose changelog already uses range-cite date headers.
- Folding in `git tag` / `git push` / version edits — separate, operator-explicit actions.

## Cite

- FORMAT.md §8 (§T), §10 (§X), §15 (atomic writes), Vm.8
- reference/changelog-mapping.md (tables), hooks/lib-changelog-write.sh (writer)
- skills/close/SKILL.md step 5 (advisory consumer)
