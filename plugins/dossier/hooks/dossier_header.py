#!/usr/bin/env python3
"""Single source of truth for reading a DOSSIER.md header state.

The header metadata line is `` `<date>` · `<state>` · `<phase>` ``. Both the
marker guard (validating a token being written) and the slop gate (asking
whether a wave is running on disk) need to agree on what that line means, so
the pattern and the state vocabulary live here rather than in each hook.

Extraction mirrors lib-regen-index.sh, which splits the line on backticks and
takes field 4. Any change to the header encoding must land in FORMAT.md, this
module, and lib-regen-index.sh together.
"""

from __future__ import annotations

import re
from pathlib import Path

HEADER_RE = re.compile(r"^`\d[^`]*`\s+·\s+`([^`]*)`\s+·\s+`")
CANONICAL_STATES = frozenset({"live", "done", "paused"})
ACTIVE_STATES = frozenset({"live", "paused"})

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
                match = HEADER_RE.match(line.strip())
                if match:
                    return match.group(1).strip()
    except OSError:
        return ""
    return ""


def has_active_dossier(cwd: str) -> bool:
    """True when cwd holds a dossier whose header state is live or paused.

    Archived waves are excluded: ds:close moves them under _archive/, and a
    closed wave must not keep workflow policy switched on.
    """
    root = Path(cwd) / DOSSIER_REL
    if not root.is_dir():
        return False
    try:
        children = sorted(root.iterdir())
    except OSError:
        return False
    for child in children[:MAX_DOSSIERS_SCANNED]:
        if not child.is_dir() or child.name == ARCHIVE_DIRNAME:
            continue
        if header_state(child / "DOSSIER.md") in ACTIVE_STATES:
            return True
    return False
