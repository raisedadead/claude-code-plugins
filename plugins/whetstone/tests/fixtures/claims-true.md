# backed claims

The `marker_guard.py` header check blocks a non-canonical token at exit 2.

`lint_skill.py` enforces the frontmatter contract and exits 1 on any FAIL.

`flake-runner.ts` gates the merge on a marker count, returning exit 0 when clean.
