# harness-alignment

consumer: a session running `ds:build` in any project with dossier installed reached-via: plugin cache → `hooks/hooks.json` (active on install) + `skills/`

## done-when

1. `bash plugins/dossier/hooks/lib-converge.sh .dossier/2026-08-01-harness-alignment.md` exits 0 and prints one line per criterion
1. `python3 plugins/dossier/tests/test_converge.py` exits 0
1. `python3 plugins/dossier/tests/test_convergence_state.py` exits 0
1. `echo '{"cwd":"/tmp/no-contract-here"}' | python3 plugins/dossier/hooks/convergence_state.py` prints nothing and exits 0
1. `git ls-files whetstone/bin/tiger-check plugins/whetstone/bin/tiger-check | wc -l` prints 1, and the file is mode 755
1. every suite green, `shellcheck` clean on changed scripts, `ruff check plugins` clean, `claude plugin validate` passes for both plugins and root

## out-of-scope

- `Stop`-hook gating — no documented loop guard, and auto-active blocking is the failure mode we are trying to remove (F27)
- positive-form rewrite of the standing rails — real, tracked as O35, its own wave
- any change to `tiger-style` behaviour — that wave is closed; only its unreachability is addressed here, via `bin/`
- retro-fitting contracts to closed waves

## budget

8 commits. At 8, `ds:converge` runs and the verdict is reported whatever it says.
