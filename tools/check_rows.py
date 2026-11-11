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

import argparse
import datetime
import re
import subprocess
import sys
from pathlib import Path

CLEAN, MALFORMED, USAGE = 0, 1, 64

ROW = re.compile(r"^\| ([DFO])\d+ ")
FACT_ROW = re.compile(r"^\| F\d+ ")
SOURCE_ROW = re.compile(r"^\| (?!-)")
UNESCAPED_PIPE = re.compile(r"(?<!\\)\|")
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")
CELLS = {"D": 6, "F": 5, "O": 8}
MAX_ROW_CHARS = 1000
MAX_AGE_DAYS = 60


def cells_of(line: str) -> list[str]:
    return UNESCAPED_PIPE.split(line.strip())[1:-1]


def long_rows(text: str, base: str) -> list[str]:
    unchanged = set(base.splitlines())
    found: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        size = len(" ".join(line.split()))
        if not ROW.match(line) or line in unchanged or size <= MAX_ROW_CHARS:
            continue
        row_id = line.split("|")[1].strip()
        found.append(
            f"WARN RESEARCH.md:{number}: {row_id} is {size} chars "
            f"(over {MAX_ROW_CHARS}), added or changed"
        )
    return found


def stale_rows(
    text: str, name: str, today: datetime.date, pattern: re.Pattern[str]
) -> list[str]:
    found: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        cells = cells_of(line) if pattern.match(line) else []
        stamp = DATE.search(cells[1]) if len(cells) > 1 else None
        if not stamp:
            continue
        label = cells[0].strip()[:60]
        try:
            age = (today - datetime.date.fromisoformat(stamp.group(0))).days
        except ValueError:
            found.append(
                f"WARN {name}:{number}: {label} has an invalid date {stamp.group(0)}"
            )
            continue
        if age > MAX_AGE_DAYS:
            found.append(
                f"WARN {name}:{number}: {label} dated "
                f"{stamp.group(0)}, {age} days ago (over {MAX_AGE_DAYS})"
            )
    return found


def base_text(path: Path, base: str) -> str | None:
    done = subprocess.run(
        ["git", "-C", str(path.parent), "show", f"{base}:./{path.name}"],
        capture_output=True,
        text=True,
    )
    return done.stdout if done.returncode == 0 else None


def warnings(
    path: Path, text: str, base: str | None, today: datetime.date
) -> list[str]:
    old = base_text(path, base) if base else None
    if old is None:
        why = f"git cannot read {base}" if base else "no --base given"
        found = [f"NOTE row length not checked: {why}"]
    else:
        found = long_rows(text, old)
    found += stale_rows(text, "RESEARCH.md", today, FACT_ROW)
    sources = path.parent / "INSPIRATIONS.md"
    if sources.is_file():
        lineage = sources.read_text(encoding="utf-8")
        found += stale_rows(lineage, "INSPIRATIONS.md", today, SOURCE_ROW)
    return found


def malformed_rows(text: str) -> list[str]:
    found: list[str] = []
    for number, line in enumerate(text.splitlines(), start=1):
        match = ROW.match(line)
        if not match:
            continue
        cells = cells_of(line)
        wanted = CELLS[match.group(1)]
        if len(cells) != wanted:
            row_id = line.split("|")[1].strip()
            found.append(
                f"RESEARCH.md:{number}: {row_id} has {len(cells)} cells, wants {wanted}"
            )
    return found


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="check_rows.py")
    parser.add_argument("path", nargs="?", default="RESEARCH.md")
    parser.add_argument(
        "--base", help="git ref that the row-length warning diffs against"
    )
    parser.add_argument("--today", help="YYYY-MM-DD; the local date when absent")
    args = parser.parse_args(argv[1:])
    path = Path(args.path)
    if not path.is_file():
        print(f"check_rows: no such file: {path}", file=sys.stderr)
        return USAGE
    text = path.read_text(encoding="utf-8")
    try:
        today = (
            datetime.date.fromisoformat(args.today)
            if args.today
            else datetime.date.today()
        )
    except ValueError:
        print(f"check_rows: --today is not a date: {args.today}", file=sys.stderr)
        return USAGE
    found = malformed_rows(text)
    advisory = warnings(path, text, args.base, today)
    for entry in found + advisory:
        print(entry)
    if found:
        print(f"ROWS: MALFORMED {len(found)}")
        return MALFORMED
    count = sum(1 for entry in advisory if entry.startswith("WARN"))
    print(f"ROWS: CLEAN, {count} warnings" if count else "ROWS: CLEAN")
    return CLEAN


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
