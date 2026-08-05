# Skill-routing evals

Two layers of confidence that every skill under `plugins/dossier/skills/` routes correctly — Layer 1 runs, Layer 2 is a written recipe with no harness yet. The plugin's other tests exercise the deterministic bash/python helpers; these target the thing those never touch — whether a `SKILL.md` **description** actually steers the router.

## Layer 1 — deterministic lint (in CI)

`hooks/eval_skill_routing.py` — a static pass, no model, no network. Catches the class of routing bug a deterministic check *can* catch:

- **Trigger-phrase collision** — two skills claiming the same quoted phrase in their `description` trigger clause. Same phrase → ambiguous routing. `FAIL`.
- **Missing trigger clause** — a `description` with no `Invoke when` / `Use when` clause at all. `FAIL`.

Run it:

```bash
python3 plugins/dossier/hooks/eval_skill_routing.py        # or pass a skills dir
```

Exit 1 on any finding. It runs in CI through `test_python.py` (`test_eval_routing_real_skills_clean`), so a newly-added skill that collides with an existing trigger phrase fails the build. When you add or rename a skill, keep its trigger phrases disjoint from the others.

## Layer 2 — live-model routing eval (manual, not in CI)

The lint above cannot tell you whether `"where are we"` actually reaches `dossier:status` rather than `dossier:check` — only a live model resolves that. A true routing eval needs a model in the loop, which means an API key, per-run cost, and non-deterministic flakiness handling. That does not belong in the deterministic CI lane, so it wants a manual harness run when you materially change a description. `ls plugins/dossier/evals/` returns this file alone: the harness below is a recipe, and nothing here has been executed against a model.

Shape: a case list of `prompt → expected-skill` (should-trigger and should-not-trigger pairs), each fed to a headless model that only knows the skill name+description metadata, then diff the selected skill against `expected`.

```
| prompt                          | expect           |
| ------------------------------- | ---------------- |
| "where are we"                  | dossier:status   |
| "check drift"                   | dossier:check    |
| "bug: login 500s on empty pass" | dossier:backprop |
| "start dossier auth-cache"      | dossier:new      |
| "roll the session"              | dossier:roll     |
| "check my inbox"                | (none)           |
| "roll back the deploy"          | (none)           |
```

Each `expect` is the `<plugin>:<skill>` id that `hooks/test_manifest.sh` resolves against `skills/<name>/SKILL.md`, not the `ds:` verb the operator types — a run whose output is compared against `ds:status` compares against a string no skill is registered under.

Drive it with `claude -p` (headless) against a scratch project that has only this plugin installed, capture which skill fires per prompt, and assert it matches `expect`. That table is the whole case list — there is no separate artifact beside this file, so extend it here. It seeds five skills plus two near-miss negatives; the remaining skills have no case written, and building the harness that runs any of it is tracked as O39.
