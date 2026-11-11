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


def test_an_open_stride_carries_started_prediction_and_check_by() -> None:
    old = _run("| O1 | a stride | why | S | open |\n")
    assert old.returncode == MALFORMED, old.stdout
    assert "has 5 cells, wants 8" in old.stdout, old.stdout
    row = "| O1 | a stride | why | S | open | 2026-11-11 | a result | 2026-12-01 |\n"
    assert _run(row).returncode == CLEAN


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


def _repo(base: str, current: str) -> Path:
    root = Path(tempfile.mkdtemp())
    git = ["git", "-C", str(root), "-c", "user.name=t", "-c", "user.email=t@t"]
    subprocess.run([*git, "init", "-q"], check=True)
    (root / "RESEARCH.md").write_text(base, encoding="utf-8")
    subprocess.run([*git, "add", "RESEARCH.md"], check=True)
    subprocess.run([*git, "commit", "-qm", "base"], check=True)
    (root / "RESEARCH.md").write_text(current, encoding="utf-8")
    return root / "RESEARCH.md"


def _check(path: Path, *flags: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), str(path), *flags], capture_output=True, text=True
    )


LONG = "x" * 1001
TAIL = "| why | S | open | 2026-11-11 | a result | 2026-12-01 |\n"


def test_a_changed_row_over_the_length_warns_and_still_exits_clean() -> None:
    path = _repo(f"| O1 | short {TAIL}", f"| O1 | {LONG} {TAIL}")
    result = _check(path, "--base", "HEAD")
    assert result.returncode == CLEAN, result.stdout
    assert "WARN RESEARCH.md:1: O1 is" in result.stdout, result.stdout
    assert "ROWS: CLEAN, 1 warnings" in result.stdout, result.stdout


def test_an_unchanged_long_row_does_not_warn() -> None:
    row = f"| O1 | {LONG} {TAIL}"
    result = _check(_repo(row, row + f"| O2 | new {TAIL}"), "--base", "HEAD")
    assert result.returncode == CLEAN, result.stdout
    assert "WARN" not in result.stdout, result.stdout


def test_column_padding_does_not_count_toward_the_length() -> None:
    padded = "| O1 | short" + " " * 1200 + TAIL
    result = _check(_repo("", padded), "--base", "HEAD")
    assert "WARN" not in result.stdout, result.stdout


def test_no_base_skips_the_length_warning_and_says_so() -> None:
    path = _repo("", f"| O1 | {LONG} {TAIL}")
    result = _check(path)
    assert "NOTE row length not checked: no --base given" in result.stdout, (
        result.stdout
    )
    assert "WARN" not in result.stdout, result.stdout


def test_a_fact_over_60_days_old_warns_and_a_fresh_one_does_not() -> None:
    rows = "| F1 | 2026-08-01 | old | s | t |\n| F2 | 2026-10-01 | new | s | t |\n"
    result = _check(_repo(rows, rows), "--today", "2026-11-01")
    assert result.returncode == CLEAN, result.stdout
    assert "WARN RESEARCH.md:1: F1 dated 2026-08-01, 92 days ago" in result.stdout
    assert "F2 dated" not in result.stdout, result.stdout


def test_an_inspirations_row_over_60_days_old_warns() -> None:
    path = _repo("", "")
    (path.parent / "INSPIRATIONS.md").write_text(
        "| source | surveyed | took |\n| [old](u) | 2026-07-31 | x |\n"
        "| [new](u) | 2026-10-09 | x |\n",
        encoding="utf-8",
    )
    result = _check(path, "--today", "2026-11-01")
    assert "WARN INSPIRATIONS.md:2: [old](u) dated 2026-07-31" in result.stdout
    assert "[new](u)" not in result.stdout, result.stdout


def test_an_inspirations_row_without_a_link_is_dated_too() -> None:
    path = _repo("", "")
    (path.parent / "INSPIRATIONS.md").write_text(
        "| source | surveyed | took |\n| --- | --- | --- |\n"
        "| `a:skill` (synced) | 2026-07-31 | x |\n",
        encoding="utf-8",
    )
    result = _check(path, "--today", "2026-11-01")
    assert "WARN INSPIRATIONS.md:3: `a:skill` (synced) dated" in result.stdout


def test_an_invalid_date_warns_and_still_exits_clean() -> None:
    rows = "| F1 | 2026-02-30 | bad | s | t |\n"
    result = _check(_repo(rows, rows), "--today", "2026-11-01")
    assert result.returncode == CLEAN, result.stdout + result.stderr
    assert "WARN RESEARCH.md:1: F1 has an invalid date 2026-02-30" in result.stdout


def test_an_invalid_today_is_a_usage_error() -> None:
    result = _check(_repo("", ""), "--today", "2026-02-30")
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
