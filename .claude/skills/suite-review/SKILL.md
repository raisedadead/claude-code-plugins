---
name: suite-review
description: Run the monthly evidence review of this repo's plugin skills. Count each skill's opportunities and uses with the census, read what happened where a skill was not used, put each skill in one bucket, act, and write the actions as predictions with a check date. Use when the operator says "suite review" or "monthly review", or when the suite-review line on LATER.md is due.
---

# Suite review

This skill is repo-local and unshipped. It reviews the skills in `plugins/*/skills/`. Run every command from the repo root.

The cut rule (D53): cut a skill only when its trigger occurs, it is not used, and the outcome without it is as good. A use count alone decides nothing.

## 1. Measure

`<since>` is the date of the last review commit, else 30 days ago:

```bash
git log -1 --format=%as --grep='^docs(research): suite review'
```

```bash
python3 tools/census/census.py skills --since <since>
python3 tools/census/census.py opportunities --since <since>
python3 tools/census/census.py verdict-log $(find ~/DEV ~/.dotfiles -maxdepth 8 \
  -path '*/.scratchpad/dossier/.verdicts.jsonl')
claude --version
```

Acted-on counts come from the ledger status lines dated on or after `<since>`:

```bash
find ~/DEV ~/.dotfiles -maxdepth 8 -path '*/.scratchpad/dossier/*' -name DOSSIER.md \
  | xargs grep -hoE '^[0-9-]{10} [0-9:]+ ds:build T[0-9]+ (doubt=FAILURES:[0-9]+-actionable|review=(PASS|CHANGES):[0-9]+-[a-z]+)' \
  | awk -v s=<since> '$1 >= s'
```

Read the entries since `<since>` in `https://raw.githubusercontent.com/anthropics/claude-code/main/CHANGELOG.md`. Note each new capability that could replace a skill or a gate, and each deprecation that touches one.

## 2. Check the last predictions

The §O row of the last review holds its predictions. When its `check-by` date is on or before today, run each check. A confirmed prediction is promoted to a §F or §D row. A refuted one reverts its change, or carries forward with the reason. Then delete the row.

## 3. Read the outcomes

`opportunities` lists the sessions where a skill's trigger fired and the skill was not used. Find a session's transcript with `find ~/.claude/projects -name '<session>.jsonl'`. Read at most 10 per skill; when there are more, read every Nth in the listed order and say so.

An outcome is as good when the session reached the checked result the skill teaches:

| skill | as good when |
|---|---|
| merge-resolve | no conflict markers remain and the tests ran, or the merge was aborted cleanly |
| skill-smith | `lint-skill` ran on the changed file and exited 0 |
| backprop | the bug got a regression test or an invariant |

A skill is surfaced in a session when its description is in that session's listing:

```bash
jq -r 'select(.attachment.type=="skill_listing") | .attachment.content' <transcript> \
  | grep -c '^- <plugin>:<skill>: '
```

Without a trusted judge (step 4), each reading is model-judgment. Label it so; the operator confirms each cut.

## 4. Judge (opt-in)

Spawn one fresh `general-purpose` agent per batch. It sees the session excerpt and the "as good when" cell, never your reading, and returns PASS, FAIL or UNSURE with a one-line critique.

Labels live in `.scratchpad/suite-review/judge-labels.tsv`: `session`, `skill`, `operator`, `judge`, `judge_model`, `prompt_sha`. Trust the judge only when it matches the operator on at least 16 of 20 operator-PASS rows and at least 16 of 20 operator-FAIL rows, counted apart. An UNSURE from either side counts as no match. Calibrate again when `judge_model` or `prompt_sha` differs from the rows that earned the trust. No plugin ships the judge (D28).

## 5. Classify

Give each plugin skill the first bucket that fits:

| bucket | evidence | action |
|---|---|---|
| too new | first commit of its `SKILL.md` under 60 days ago | none |
| not surfaced | a worse outcome, and the description absent from that session's listing | fix the listing before the description |
| missed by model | not-used sessions read, and any outcome worse | rewrite the description; add a should / should-not eval case |
| not needed | not-used sessions read, every outcome as good | cut the `SKILL.md` once the operator confirms; a script another skill or `bin/` calls stays |
| used | Skill calls or typed commands in the window | none |
| used via script | its script ran (`script` column) | none |
| human missed | the operator did the step by hand where the skill fits | add a hand-off line where the need shows |
| unclassified | no detector, or a detector too loose to read | none; name a better detector |

First commit date: `git log --diff-filter=A --format=%as -- plugins/*/skills/<skill>/SKILL.md | tail -1`.

## 6. Act and predict

Write one §O row in `RESEARCH.md` for this review: the stride names the actions, `started` is today, `prediction` lists what the next census will show for each action, and `check-by` is the next review date. Keep §O at 7 rows or fewer: drop or merge a row, with its reason, before you add one past the cap.

Replace the suite-review line on `.scratchpad/dossier/LATER.md`, a month on:

```
- suite-review/T1 · Run /suite-review (last <today>, Claude Code <version>) · A · due <date>
```

Run `python3 tools/check_rows.py`, then commit with the subject `docs(research): suite review <today>`.

## Report

One line per skill: its bucket, the numbers that put it there, and the action. Then the predictions checked in step 2, the acted-on counts, and the new §O row.
