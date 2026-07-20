# whetstone

Engineering-craft skills that sharpen the edge before you cut. Five small, composable skills — each carries a **deterministic self-verify**, so "done" is a checkable fact, not a vibe.

Sibling to [`dossier`](../dossier): dossier is the phase-scoped ledger for a whole wave of work; whetstone is the per-task craft you reach for inside it (or on their own).

## Install

```
/plugin marketplace add raisedadead/claude-code-plugins
/plugin install whetstone@raisedadead-plugins
```

`python3` ≥ 3.10 on `PATH` for the two python helpers (`skill-smith` lint, `flaky-test-audit` rate). The shell helpers need only `bash` + `git`.

## Skills

| Skill              | Loop  | Reach for it when…                                                                                                   | Self-verify (deterministic)                                                  |
| ------------------ | ----- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `tdd-cycle`        | turn  | authoring behaviour test-first (standalone driver; under a dossier covenant, `ds:build` composes its `run_slice.sh`) | `run_slice.sh`: RED must exit non-zero, GREEN + full suite exit 0            |
| `flaky-test-audit` | sweep | "is this test flaky", scheduled test-health check                                                                    | `compute_flakiness.py`: per-test rate `0<r<1` = flaky, by the number         |
| `doubt-pass`       | goal  | stress-testing a plan/design **before** any code exists                                                              | 3-cycle cap; every finding classified; "doubt theater" flagged               |
| `merge-resolve`    | turn  | resolving merge/rebase conflicts                                                                                     | `verify_clean.sh`: 0 conflict markers AND pass-count ≥ pre-conflict baseline |
| `skill-smith`      | goal  | writing / reviewing a `SKILL.md`                                                                                     | `lint_skill.py`: frontmatter + line-budget + reference-depth checks          |

Each skill's `description` carries its own trigger phrases, so the model reaches for the right one; you can also invoke any by name.

## Philosophy

Borrowed from the way good engineers already work, and from the "designing loops" lens:

- **Give the model a way to verify its own work.** Every skill ends in a script or a checkable gate, never "looks right."
- **Separate the moments.** `doubt-pass` challenges a plan *before* code; `skill-smith` lints *after* authoring; `tdd-cycle` drives *during*. Distinct skills for distinct moments.
- **Deterministic over discretionary.** A flake is a computed rate; a clean merge is a marker count of zero; a done slice is an exit code. Numbers, not judgement, where a number exists.

## Agent

Ships one read-only subagent, `whetstone-doubter` — a fresh-context adversarial reviewer. `doubt-pass` hands it an **artifact-only** mission (the extracted plan + contract, no conversation or rationale) and reads its deterministic `DOUBT: FAILURES | NO FAILURE FOUND` verdict. Fresh context is the point: an agent that never saw the plan's justification falsifies it instead of rationalizing it. Refuses all writes (`Edit` / `Write` / `NotebookEdit` blocked). Spawn directly via `Agent({subagent_type: "whetstone:whetstone-doubter", ...})` to attack any plan artifact.

When [`dossier`](../dossier) is installed alongside, its `ds:build` auto-composes this agent on design-class tasks — a pre-WORK doubt gate, no trigger phrase required (see dossier `ADAPTERS.md` §whetstone for detection + graceful-skip semantics).

## Files

```
plugins/whetstone/
├── .claude-plugin/plugin.json
├── CHANGELOG.md           # dated change log (commit-SHA versioning mode)
├── agents/
│   └── whetstone-doubter.md  # fresh-context adversarial reviewer (doubt-pass)
├── skills/
│   ├── tdd-cycle/         # SKILL.md + scripts/run_slice.sh + reference/
│   ├── flaky-test-audit/  # SKILL.md + scripts/{flake_runner.sh,compute_flakiness.py} + reference/
│   ├── doubt-pass/        # SKILL.md + reference/
│   ├── merge-resolve/     # SKILL.md + scripts/verify_clean.sh + reference/
│   └── skill-smith/       # SKILL.md + scripts/lint_skill.py + reference/
├── tests/                 # python + shell test suites (wired into CI)
└── README.md              # you are here
```

## License

ISC License — see [LICENSE](../../LICENSE).
