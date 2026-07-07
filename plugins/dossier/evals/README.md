# Skill-routing evals

Two layers of confidence that the 9 skills route correctly. The plugin's other tests exercise the deterministic bash/python helpers; these target the thing those never touch — whether a `SKILL.md` **description** actually steers the router.

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

The lint above cannot tell you whether `"where are we"` actually reaches `ds:status` rather than `ds:check` — only a live model resolves that. A true routing eval needs a model in the loop, which means an API key, per-run cost, and non-deterministic flakiness handling. That does not belong in the deterministic CI lane, so it is a manual harness you run when you materially change a description.

Shape: a case list of `prompt → expected-skill` (should-trigger and should-not-trigger pairs), each fed to a headless model that only knows the skill name+description metadata, then diff the selected skill against `expected`.

```
| prompt                          | expect      |
| ------------------------------- | ----------- |
| "where are we"                  | ds:status   |
| "check drift"                   | ds:check    |
| "bug: login 500s on empty pass" | ds:backprop |
| "start dossier auth-cache"      | ds:new      |
| "roll the session"              | ds:roll     |
```

Drive it with `claude -p` (headless) against a scratch project that has only this plugin installed, capture which skill fires per prompt, and assert it matches `expect`. Keep the case list next to this file as it grows.
