# Skill failure modes

Six ways a skill rots, from Matt Pocock's writing-great-skills. `lint_skill.py` exits 0 on every one of them; this list is read by hand.

| Mode                     | What it looks like                                                                 | Catch it by                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| **Premature completion** | The skill declares done before the work is actually verifiable.                    | Demand a checkable exit criterion — a command, count, or exit code.           |
| **Duplication**          | Two skills (or a skill and a rule) say the same thing; they drift apart over time. | One home per fact; every other mention points at it.                                         |
| **Sediment**             | Stale steps left in "just in case" after the process moved on.                     | Delete what the current process no longer runs.                               |
| **Sprawl**               | The skill grew to cover five loosely-related jobs.                                 | Split by trigger. One skill, one moment.                                      |
| **No-op**                | A step that reads well but changes nothing — narration dressed as instruction.     | Ask what observable thing each step produces. Cut the ones that produce none. |
| **Negation**             | Prohibition framing that plants the behaviour it forbids (the pink-elephant problem).                    | Say what to do. Keep a prohibition where a hook denies the action, paired with the positive.              |

## Two more smells worth a glance

- **Router that lies** — a skill whose description promises a trigger it no longer handles, or omits one it does. Re-read the description against the body.
- **Buried rebuttal** — a load-bearing "why not skip this" stated once mid-paragraph. Pull it into a Common-rationalizations table where it is hard to skim past.
