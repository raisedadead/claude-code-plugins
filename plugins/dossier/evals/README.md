# Skill-routing evals

Two layers of confidence that a `SKILL.md` **description** steers the router to the right skill. The plugin's other tests exercise the deterministic helpers; these target the thing those never touch.

## Layer 1 — deterministic lint (in CI)

`hooks/eval_skill_routing.py` — a static pass, no model, no network:

- **Trigger-phrase collision** — two skills claiming the same quoted phrase in their `description`. `FAIL`.
- **Missing trigger clause** — a `description` with no `Invoke when` / `Use when` clause. `FAIL`.

```bash
python3 plugins/dossier/hooks/eval_skill_routing.py        # or pass a skills dir
```

Exit 1 on any finding. CI runs it through `test_python.py` (`test_eval_routing_real_skills_clean`).

## Layer 2 — live-model routing (manual, not in CI)

The lint cannot tell whether `"where are we"` reaches `dossier:status` rather than `dossier:check`; only a live model resolves that. Each directory here is a [`claude plugin eval`](https://code.claude.com/docs/en/plugin-evals) case: a `prompt.md` a user might type, and a `tool_used` grader on the `Skill` call it should produce — or, for `none-*` cases, must not produce.

```bash
claude plugin eval plugins/dossier --ablation none --runs 3
```

`--ablation none` matters: in the default two-arm run a `tool_used: Skill` grader is reported as a plugin-fired indicator rather than scored. Runs cost model calls on your own credentials, which is why this stays out of the deterministic CI lane. Results land in `evals/results/`, which is gitignored.

Add a case per skill whose description you change, and a `none-*` near miss for any phrase that should not route here.
