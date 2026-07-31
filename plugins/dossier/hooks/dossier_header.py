#!/usr/bin/env python3
"""Single source of truth for reading a DOSSIER.md header state.

The header metadata line is `` `<date>` · `<state>` · `<phase>` ``. Both the
marker guard (validating a token being written) and the slop gate (asking
whether a wave is running on disk) need to agree on what that line means, so
the pattern and the state vocabulary live here rather than in each hook.

Two patterns live here and they are not interchangeable. `HEADER_RE` validates
a state token being written and is deliberately strict. `AWK_HEADER_RE` reads
what is already on disk and is a transcription of lib-regen-index.sh:29 — the
authority for what a ledger's state is — down to its looseness, so the slop
gate and INDEX.md can never disagree about whether a wave is running. They did
disagree while this module used the strict pattern for both jobs: a header with
a leading space inside the date span read as live to the shell and as nothing
to Python. `test_header_parity.sh` runs both extractors over shared fixtures so
that class stays closed. Any change to the header encoding must land in
FORMAT.md, this module, and lib-regen-index.sh together.
"""

from __future__ import annotations

import re
from pathlib import Path

HEADER_RE = re.compile(r"^`\d[^`]*`\s+·\s+`([^`]*)`\s+·\s+`")
CANONICAL_STATES = frozenset({"live", "done", "paused"})
ACTIVE_STATES = frozenset({"live", "paused"})

AWK_HEADER_RE = re.compile(r"^`.*` · `.*` · ")
AWK_STATE_FIELD = 3

DOSSIER_REL = Path(".scratchpad") / "dossier"
ARCHIVE_DIRNAME = "_archive"
MAX_HEADER_LINES = 8
MAX_DOSSIERS_SCANNED = 128


def header_state(ledger: Path) -> str:
    """Return the state token from a ledger's header line, or "" if absent."""
    try:
        with ledger.open(encoding="utf-8", errors="replace") as handle:
            for _ in range(MAX_HEADER_LINES):
                line = handle.readline()
                if not line:
                    break
                if AWK_HEADER_RE.match(line):
                    fields = line.split("`")
                    if len(fields) > AWK_STATE_FIELD:
                        return fields[AWK_STATE_FIELD].strip()
                    return ""
    except OSError:
        return ""
    return ""


def has_active_dossier(cwd: str) -> bool:
    """True when cwd holds a dossier whose header state is live or paused.

    Archived waves are excluded: ds:close moves them under _archive/, and a
    closed wave must not keep workflow policy switched on.

    An unreadable or unparseable ledger counts as not active. A corrupt header
    means we cannot show a wave is running, and workflow policy should follow
    what is demonstrable rather than assume the stricter reading.

    Scanned newest-first because slugs are date-prefixed and the bound must
    discard the least likely candidates: closed waves accumulate while the
    newest is the live one, so an ascending scan would drop exactly the ledger
    being looked for.
    """
    root = Path(cwd) / DOSSIER_REL
    if not root.is_dir():
        return False
    try:
        children = sorted(root.iterdir(), reverse=True)
    except OSError:
        return False
    for child in children[:MAX_DOSSIERS_SCANNED]:
        if not child.is_dir() or child.name == ARCHIVE_DIRNAME:
            continue
        if header_state(child / "DOSSIER.md") in ACTIVE_STATES:
            return True
    return False
