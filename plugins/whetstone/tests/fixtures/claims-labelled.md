# labelled claims

`marker_guard.py` blocks nothing on the advisory path — it emits a nag.

`skill_gate.py` gates the built-in review commands, but the reminder is non-blocking and honoring it is model-judgment.

The `--review` flag gates a fresh-context reviewer; it is opt-in and never fires on its own.
