# turn-gates

| field       | value                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| consumer    | the operator, for the response-length gate; anyone running whetstone, for `claim-check --stdin`      |
| reached-via | rig: `home apply` installs the Stop hook · plugin: `whetstone/bin/claim-check --stdin`, resolved by full path from `installed_plugins.json` |
| budget      | 12 commits                                                                                           |

## why

Measured, not assumed. `.scratchpad/census/REPORT.md` §10: across 581 Opus 5 main-thread turns, 9.5% contain a self-correction, and the sampled corrections share one shape — an assertion made without a probe, caught afterwards. §4 of the same report: every convergence bound in the suite is a sentence addressed to a model, and `grep -rn "REVIEW:\|DOUBT:\|NO FAILURE" plugins` returns nothing, so no code reads a verdict.

The operator asks for shorter replies and first-time-right code. Both are prose rules today. This wave turns two of them into exit codes.

## done-when

| id  | command                                                                                           | expect    |
| --- | ------------------------------------------------------------------------------------------------- | --------- |
| 1   | `python3 plugins/whetstone/tests/test_claim_check.py`                                             | exit 0    |
| 2   | `printf 'The hook blocks the write.\n' \| bash plugins/whetstone/bin/claim-check --stdin`         | exit 1    |
| 3   | `printf 'The hook blocks the write, exit 2.\n' \| bash plugins/whetstone/bin/claim-check --stdin` | exit 0    |
| 4   | `bash plugins/whetstone/bin/claim-check plugins/whetstone/tests/fixtures/claims-false.md`         | exit 1    |
| 5   | `bash plugins/whetstone/bin/claim-check $(git ls-files '*.md' \| grep -v tests/fixtures/)`        | exit 0    |
| 6   | `ruff check plugins`                                                                              | exit 0    |
| 7   | `shellcheck plugins/whetstone/bin/claim-check`                                                    | exit 0    |
| 8   | `claude plugin validate plugins/whetstone`                                                        | exit 0    |
| 9   | `python3 ~/.dotfiles-private/dot_claude/hooks/test_executable_hooks.py`                           | exit 0    |
| 10  | `python3 ~/.dotfiles-private/dot_claude/hooks/test_executable_hooks.py TestLengthGate 2>&1 \| grep -c '^OK'` | stdout: 1 |
| 12  | `python3 ~/.dotfiles-private/dot_claude/hooks/test_executable_hooks.py TestClaimGate 2>&1 \| grep -c '^OK'`  | stdout: 1 |
| 11  | `cd ~/.dotfiles-private && git diff --name-only HEAD~1 -- ARCHI.md \| grep -c ARCHI.md`           | stdout: 1 |

Criteria 2 and 3 are the pair the testing standard asks for: one proves the stdin mode fires, one proves it does not false-positive. Criterion 4 proves the file mode still works, so the new input surface has not regressed the old one. Criteria 10 and 12 name the rig's two gate suites. They match on `^OK` rather than on an exit code because `-k length_gate` selected zero tests and still read as a pass — a criterion that proves nothing looks identical to one that passes. `NO TESTS RAN` prints no `OK`, so this form fails when selection breaks.

Criterion 11 is the ARCHI tenet — a rig change and its ARCHI edit land in the same commit — expressed as a command rather than a promise.

## the ceiling

40 lines, block once. Chosen by the operator over 25 and 15.

`ARCHITECTURE.md:70` is the reason: a gate that blocks on a signal it cannot back gets disabled within a week, and then it enforces nothing. A line count is computed, so the signal is backable; an over-eager ceiling is what would get it switched off. The existing `stop_hook_active` guard bounds the loop to one rewrite for free.

## coverage, stated honestly

`claim-check --stdin` catches the enforcement-claim shape and nothing wider: the same five verbs (`blocks`, `enforces`, `gates`, `denies`, `prevents`), the same BACKED / LABELLED logic, a new input surface. Against the four correction types sampled in the census, it catches roughly one.

That is deliberate. The 2026-08-01 claim-check wave already ruled on the wider net — its own constraint reads "widening the net past what can be judged mechanically turns it into a nag people disable", and `claim_check.py`'s docstring says "F25's class is only half mechanical and this is that half". A general unprobed-assertion detector is the rejected alternative, not an unbuilt feature.

## out-of-scope

- A general detector for "asserted without probing". Rejected 2026-08-01; see above.
- The length gate as a plugin feature. A response budget is one operator's taste, and ARCHITECTURE.md:100 says a style opinion should not ship to everyone who installs the plugin. It stays in the rig.
- Any verdict-parsing hook (O21). Same root cause, different wave, and it wants its own contract.
- Pushing either repo. Work completes at commit.

## notes

The rig calls `claim-check` from the installed plugin cache, not from this repo's source tree. **It resolves the full path from `~/.claude/plugins/installed_plugins.json`, because a plugin's `bin/` is added to the Bash tool's PATH and to nothing else** — not hooks, not MCP, not LSP (`code.claude.com/docs/en/plugins-reference`, read 2026-08-16). This wave's first design assumed process-wide PATH and would have produced a gate that never resolved anything, forever, with fail-open hiding it. Until a cache refresh carries `--stdin`, the installed build returns exit 64 and the gate stays inert by construction.

`home apply` will restore the `model: claude-fable-5[1m]` pin currently drifted out of the live `settings.json`. That changes the default model. Flag it before applying; do not apply silently.
