#!/usr/bin/env python3
"""Assert every RESEARCH.md ledger row fills the cells its header declares.

A row short of a cell reads as complete. Three `§F` rows once shipped with the
`source` and `recheck trigger` cells missing entirely, and the prose in the
`fact` cell read as evidence — the rows written to close an evidence gap were
themselves unciteable, and no reader caught it across two passes.

Splitting on a bare `|` is the wrong check: `F24` carries a literal `\\|` inside
its fact cell and a naive split reports it as malformed. That false positive is
what would get this script deleted, so the split ignores escaped pipes.

Exit codes:
  0  every row well-formed
  1  at least one row is short or long
  64 usage error — RESEARCH.md not found
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

CLEAN, MALFORMED, USAGE = 0, 1, 64

ROW = re.compile(r"^\| ([DFO])\d+ ")
UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")
CELLS = {"D": 6, "F": 5, "O": 5}


def malformed_rows(text: str) -> list[str]:
    found: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = ROW.match(line)
        if not match:
            continue
        cells = UNESCAPED_PIPE.split(line.strip())[1:-1]
        wanted = CELLS[match.group(1)]
        if len(cells) != wanted:
            row_id = line.split("|")[1].strip()
            found.append(
                f"RESEARCH.md:{number}: {row_id} has {len(cells)} cells, wants {wanted}"
            )
    return found


def main(argv: list[str]) -> int:
    path = Path(argv[1]) if len(argv) > 1 else Path("RESEARCH.md")
    if not path.is_file():
        print(f"check_rows: no such file: {path}", file=sys.stderr)
        return USAGE
    found = malformed_rows(path.read_text(encoding="utf-8"))
    for entry in found:
        print(entry)
    if found:
        print(f"ROWS: MALFORMED {len(found)}")
        return MALFORMED
    print("ROWS: CLEAN")
    return CLEAN


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
