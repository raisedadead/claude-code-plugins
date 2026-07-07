# Skill failure modes

Six ways a skill rots, from Matt Pocock's writing-great-skills. A clean `lint_skill.py` run says nothing about these — read a skill against them by hand.

| Mode                     | What it looks like                                                                 | Catch it by                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Premature completion** | The skill declares done before the work is actually verifiable.                    | Demand a checkable exit criterion — a command, count, or exit code.           |
| **Duplication**          | Two skills (or a skill and a rule) say the same thing; they drift apart over time. | One home per fact. Point, don't copy.                                         |
| **Sediment**             | Stale steps left in "just in case" after the process moved on.                     | Delete what the current process no longer runs.                               |
| **Sprawl**               | The skill grew to cover five loosely-related jobs.                                 | Split by trigger. One skill, one moment.                                      |
| **No-op**                | A step that reads well but changes nothing — narration dressed as instruction.     | Ask what observable thing each step produces. Cut the ones that produce none. |
| **Negation**             | "Don't do X" framing that plants X (the pink-elephant problem).                    | Prefer positive framing: say what to do, not only what to avoid.              |

## Two more smells worth a glance

- **Router that lies** — a skill whose description promises a trigger it no longer handles, or omits one it does. Re-read the description against the body.
- **Buried rebuttal** — a load-bearing "why not skip this" stated once mid-paragraph. Pull it into a Common-rationalizations table where it is hard to skim past.
