---
name: whetstone-research-report
description: Research a technical question with probes on the local system, a web fan-out through deep-research, a grounding pass on every load-bearing claim, and a report rendered as one HTML page. Use when the user asks for a research report, a design study or an evidence-backed recommendation about their own system.
---
## Pi runtime

Resolve bundled paths against this file, not the project working directory. The plugin root is `../..` from this file's directory. Before each shell call that uses `$WHETSTONE_PLUGIN_ROOT`, set that variable to the shell-quoted absolute plugin root in that same shell. Pi does not supply it. Keep the shell working directory in the consuming project.

Load another installed skill with `read` on its advertised SKILL.md path; user commands use `/skill:<name>`. Check the available skills and tools before an optional sibling route. An absent sibling means skip, never install or scan caches. Pi does not add plugin bin directories to PATH: resolve bundled tools by absolute path. For dossier-to-whetstone script routes, check `../whetstone/bin/<tool>` relative to dossier's plugin root; if absent, use the documented absent-skip result.

Use `read/edit/write/bash/grep/find` for the corresponding host operations. Fresh missions use `dossier_delegate` or `whetstone_delegate` for that plugin's named agents, with unqualified `agent` and artifact-only `task`. The tool uses the current model unless the operator supplies an exact `provider/model`. Builders use `agent: general-purpose, write: true`; named reviewers cannot use edit/write. Bash read-only is prompt-only, not a sandbox. A return is final: a follow-up mission is a fresh call, not a message to a retained agent. Parallel independent missions may use concurrent calls.

Web tools and advisor tools are optional. Use installed web tools when present, or read-only `curl`/`gh api` through bash; identify any inaccessible source. The Pi extension supplies mutation guards and model-facing advisories. The task ledger is authoritative; `/dossier-tasks` is a read-only view, not a second task store.


# research-report — local probes, web evidence, grounded claims, one readable page

`anthropic-skills:deep-research` runs the web fan-out and writes notes. This skill adds what it lacks: probes on the operator's own system, advisor checkpoints, a grounding pass, a fixed report shape and the HTML render.

## Before you start

An explicit request for this research report is consent to the described fan-out. If you selected this method without that request, ask once before spawning agents.

Work in `.scratchpad/research/<YYYY-MM-DD>-<slug>/`, the research directory. Every file this skill names goes there.

## Steps

1. **Probe the real system first.** Read the installed source, the schema, the config, the data volumes. Save each probe as `probes/<n>-<name>.md`: the exact command, its output, the date. Probes are read-only; confirm isolation before a probe that writes. Cap a long run at 5 minutes and record the cap. Done when every fact the question depends on locally has a probe file.
1. **Plan with the advisor.** Call `advisor` when the session has it. Write `plan.md`: the question in one sentence, the facets (3 to 6, no overlap), the deliverable shape and the stop rule (every facet reported, at most one gap round).
1. **Fan out to the web.** Run `anthropic-skills:deep-research` on the question and the facets from `plan.md`. It writes `research_notes/<title>/` and `reports/<title>.md` in the directory it used for research earlier in the conversation, else in the current working directory; when it is done, move both into the research directory. Its narrative report is an input to `report.md`, not the deliverable. Without deep-research, spawn one `whetstone-scout` per facet, all in one message, and save each claim table to `notes/<facet>.md`.
1. **Check the stop rule with the advisor.** Deep-research's own gap round is the one round; here, only check that each facet has claims and record the uncovered ones as open items. Without deep-research, a facet with no claims gets one gap round.
1. **Ground every load-bearing claim.** List each claim the answer or a decision rests on, with its source (URL, `path:line` or command), about 20 to 40 claims. Call `whetstone_verify_claims` with `{ question, claims, batch: 5 }`. Its results are model-judgment; malformed or missing rulings are `UNRULED`. For each claim that is not `CONFIRMED`, correct it from the source or mark it `UNVERIFIED:` in the report. Save the result as `grounding.md`.
1. **Write `report.md`** to the shape in [report-core.md](reference/report-core.md). Every number cites a probe, a `[key]` source or `UNVERIFIED:`.
1. **Render.** Run the `/skill:whetstone-html-report` skill on `report.md` to `report.html`, then read every figure it lists. Re-render after the last edit to `report.md`.
1. **Check with the advisor**, then account for every agent you spawned: arrived or pending.

Hand over: the HTML path, the answer in 3 to 5 bullets, and the count of `UNVERIFIED:` claims.

## Honesty labels

| claim                                                   | enforced by                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------------------- |
| each claim gets a verdict                               | code — verify-claims marks a claim with no ruling `UNRULED`            |
| a verdict is correct                                    | model-judgment — a grounder reads the source                           |
| a broken diagram stops the render                       | code — `html-report` exit 1                                            |
| probes are read-only                                    | model-judgment — this prompt; no hook checks a probe                   |
| deep-research output ends in the research directory | model-judgment — deep-research writes to the conversation's research directory or the cwd; step 3 moves it |
| the advisor runs at steps 2, 4 and 8                    | model-judgment — no hook checks the calls                              |
