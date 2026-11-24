# The end of a dossier turn

This file says how each turn of `/dossier:plan`, `/dossier:build` and `/dossier:ship` ends.

1. Run `ds handoff`. Print none of its lines.
2. A turn that ends on a Decide card ends on that card. It starts no step and prints no other card.
3. Else start the step on the `next:` line of `ds handoff` only when each of these holds:
   - it prints no `operator:` line;
   - the last `ds` command before `ds handoff` did not exit 1 or 2;
   - the last run in this turn of each `ds` command did not exit 3, except the first `ds ci` exit 3 of a branch tip for a run that has not ended;
   - the step's helper or its background command does not still run;
   - without `--auto`, the turn built no row.
4. When no step starts, end the turn on one Do card, last. It has one step for each operator step, in this order:
   - each `operator:` line, as `[H] <row id> <title>`, with the reason after its `·` when it has one;
   - the command or the URL that a `ds` exit 3 names, such as the resume command of a paused dossier, or the URL of a CI run that waits for approval or has not ended;
   - the operator's step for a failed `ds` command: `gh auth login` for `gh failed: HTTP 401`, and each failed check by name for a `CHECK: FAIL` that still stands at the end of the turn; the session runs the failed command again after the operator replies;
   - last, the skill on the `next:` or `close:` line of `ds handoff`, such as `/dossier:build`. Leave out a `next:` skill while a helper or a background command still runs, or when the last `ds` command failed.

   A `close:` line is always the operator's step: the session does not start `/dossier:close`.

   With no operator step, print no card. After a failed `ds` command, report its error line.

A dossier turn prints no other card and no line after the card.
