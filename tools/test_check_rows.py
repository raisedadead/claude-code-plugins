#!/usr/bin/env python3
"""Stdlib-only tests for check_rows.py. Run directly or via pytest."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

CHECK = Path(__file__).resolve().parent / "check_rows.py"
RESEARCH = Path(__file__).resolve().parent.parent / "RESEARCH.md"

CLEAN, MALFORMED, USAGE = 0, 1, 64


def _run(text: str) -> subprocess.CompletedProcess[str]:
    with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as handle:
        handle.write(text)
        path = handle.name
    return subprocess.run(
        [sys.executable, str(CHECK), path], capture_output=True, text=True
    )


def test_a_short_row_is_malformed() -> None:
    result = _run("| F32 | 2026-08-16 | a fact |\n")
    assert result.returncode == MALFORMED, result.stdout
    assert "has 3 cells, wants 5" in result.stdout, result.stdout


def test_a_complete_fact_row_is_clean() -> None:
    result = _run("| F32 | 2026-08-16 | a fact | a source | a trigger |\n")
    assert result.returncode == CLEAN, result.stdout


def test_an_escaped_pipe_is_not_a_cell_boundary() -> None:
    """F24 carries a literal `\\|` in its fact cell. A naive split calls that
    row malformed, and that false positive is what gets a lint deleted."""
    result = _run("| F24 | 2026-07-31 | flags `a \\| true` | a source | a trigger |\n")
    assert result.returncode == CLEAN, result.stdout


def test_a_decision_row_wants_six_cells() -> None:
    result = _run("| D18 | 2026-08-16 | decision | rejected | why | evidence |\n")
    assert result.returncode == CLEAN, result.stdout
    result = _run("| D18 | 2026-08-16 | decision | rejected | why |\n")
    assert result.returncode == MALFORMED, result.stdout


def test_a_header_or_separator_is_not_a_row() -> None:
    result = _run(
        "| id  | verified | fact | source | recheck trigger |\n| --- | --- |\n"
    )
    assert result.returncode == CLEAN, result.stdout


def test_a_missing_file_is_a_usage_error() -> None:
    result = subprocess.run(
        [sys.executable, str(CHECK), "/nonexistent/RESEARCH.md"],
        capture_output=True,
        text=True,
    )
    assert result.returncode == USAGE, result.stdout + result.stderr


def test_the_repos_own_research_file_is_clean() -> None:
    result = subprocess.run(
        [sys.executable, str(CHECK), str(RESEARCH)], capture_output=True, text=True
    )
    assert result.returncode == CLEAN, result.stdout


def _main() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except Exception as exc:
            failures += 1
            print(f"FAIL {name}: {type(exc).__name__}: {exc}", file=sys.stderr)
        else:
            print(f"ok {name}")
    if failures:
        print(f"{failures} failing", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
