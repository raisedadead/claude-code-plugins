---
name: merge-resolve
description: Resolve git merge or rebase conflicts hunk-by-hunk with mandatory post-resolution verification. Use when the user hits a merge conflict, asks to resolve conflicts, fix the merge, or handle a rebase conflict, or when git reports CONFLICT / "both modified".
---

# merge-resolve — resolve, then prove it clean

Two numbers make "done" checkable: zero conflict markers left, and a test pass-count at or above the pre-conflict baseline. Resolving the hunks is the first half; the numbers are the second.

## When to use

- `git merge` / `git rebase` / `git cherry-pick` reports a conflict.
- The user asks to resolve conflicts or fix a merge.

## Process

1. **Capture the baseline first.** Before touching any conflicted file, run the suite and record the passing-test count. That count is the floor. (When the suite cannot run pre-resolution, pass `-` in step 3.)

1. **Resolve hunk by hunk**, per `reference/resolution-heuristics.md`. Read both sides' diffs and pick per hunk, so each side's intent is seen before one of them loses. Regenerate lockfiles and generated files from source.

1. **Verify:**

   ```bash
   "${CLAUDE_PLUGIN_ROOT}"/skills/merge-resolve/scripts/verify_clean.sh <root> <baseline-count> <count-command...>
   ```

   It exits non-zero when a conflict marker (`<<<<<<< `, `>>>>>>> `, `||||||| `) remains under `<root>`, or when `<count-command>` (a pipeline that prints the current passing-test count as a bare integer) reports fewer passes than `<baseline-count>`. Pass `-` as the baseline to check markers only.

   ```bash
   verify_clean.sh . 128 sh -c 'pytest -q 2>/dev/null | grep -oE "[0-9]+ passed" | grep -oE "[0-9]+"'
   ```

1. **Hand off to commit.** Staging and the commit stay the operator's call, along with any git-safety rules the host enforces.

## Common shortcuts (and why not)

| Tempting shortcut                        | Why not                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| Blind `git checkout --ours` / `--theirs` | Discards one side's intent unseen. Read both diffs; pick per hunk.        |
| Hand-merge a lockfile / generated file   | Regenerate it from source instead — a hand-merged lockfile is a landmine. |
| Skip the pre-resolution baseline         | Without the floor, a resolution that silently drops tests still "passes". |
| Commit as soon as markers are gone       | Markers gone ≠ behaviour intact. Re-run the suite against the baseline.   |

## Verification

Done = `verify_clean.sh` exits 0: zero markers, and pass-count ≥ the pre-conflict baseline. The script captures both numbers.

## Dossier breadcrumb

In a repo with a live dossier ledger, record the verdict as one §S line through the dossier plugin's append tooling (the host session reminds when applicable; the first live row is the current dossier). No dossier → skip: this skill ships no hooks and no dossier dependency.
