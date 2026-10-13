---
name: research-report
description: Research a technical question with probes on the local system, a web fan-out through deep-research, a grounding pass on every load-bearing claim, and a report rendered as one HTML page. Use when the user asks for a research report, a design study or an evidence-backed recommendation about their own system.
---

# research-report — local probes, web evidence, grounded claims, one readable page

`anthropic-skills:deep-research` runs the web fan-out and writes notes. This skill adds what it lacks: probes on the operator's own system, advisor checkpoints, a grounding pass, a fixed report shape and the HTML render.

## Before you start

The user invoked this skill by name: go on. Claude routed it: ask once, because the run spawns several agents and a workflow, then go on after a yes.

Work in `.scratchpad/research/<YYYY-MM-DD>-<slug>/`, the research directory. Every file this skill names goes there.

## Steps

1. **Probe the real system first.** Read the installed source, the schema, the config, the data volumes. Save each probe as `probes/<n>-<name>.md`: the exact command, its output, the date. Probes are read-only; confirm isolation before a probe that writes. Cap a long run at 5 minutes and record the cap. Done when every fact the question depends on locally has a probe file.
1. **Plan with the advisor.** Call `advisor` when the session has it. Write `plan.md`: the question in one sentence, the facets (3 to 6, no overlap), the deliverable shape and the stop rule (every facet reported, at most one gap round).
1. **Fan out to the web.** Run `anthropic-skills:deep-research` on the question and the facets from `plan.md`. It writes `research_notes/<title>/` and `reports/<title>.md` in the directory it used for research earlier in the conversation, else in the current working directory; when it is done, move both into the research directory. Its narrative report is an input to `report.md`, not the deliverable. Without deep-research, spawn one `whetstone:whetstone-scout` per facet, all in one message, and save each claim table to `notes/<facet>.md`.
1. **Check the stop rule with the advisor.** Deep-research's own gap round is the one round; here, only check that each facet has claims and record the uncovered ones as open items. Without deep-research, a facet with no claims gets one gap round.
1. **Ground every load-bearing claim.** List each claim the answer or a decision rests on, with its source (URL, `path:line` or command), about 20 to 40 claims. Run the `whetstone:verify-claims` workflow with `args: { question, claims, batch: 5 }`. For each claim that is not `CONFIRMED`, correct it from the source or mark it `UNVERIFIED:` in the report. Save the result as `grounding.md`.
1. **Write `report.md`** to the shape in [report-core.md](reference/report-core.md). Every number cites a probe, a `[key]` source or `UNVERIFIED:`.
1. **Render.** Run the `whetstone:html-report` skill on `report.md` to `report.html`, then read every figure it lists. Re-render after the last edit to `report.md`.
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
