#!/usr/bin/env python3
"""Stdlib-only tests for tiger_check.py. Run directly or via pytest."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
CHECK = PLUGIN / "skills" / "tiger-style" / "scripts" / "tiger_check.py"

CLEAN = 0
BLOCK = 1
NAG = 2
USAGE = 64


def _git(repo: Path, *args: str) -> None:
    subprocess.run(
        ["git", *args],
        cwd=repo,
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def _init(repo: Path) -> None:
    _git(repo, "init", "-q", "-b", "main")
    _git(repo, "config", "user.email", "t@example.com")
    _git(repo, "config", "user.name", "t")


def _commit(repo: Path, message: str) -> None:
    _git(repo, "commit", "-q", "-m", message)


def _write(repo: Path, rel: str, body: str) -> None:
    path = repo / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def _run(repo: Path, **env_overrides: str) -> subprocess.CompletedProcess[str]:
    env = dict(os.environ)
    env.pop("WHETSTONE_TIGER_COLS", None)
    env.update(env_overrides)
    return subprocess.run(
        [sys.executable, str(CHECK), str(repo)],
        capture_output=True,
        text=True,
        env=env,
    )


def _line(width: int) -> str:
    return "x" * width + "\n"


def test_clean_under_default() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(40))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert "TIGER: CLEAN" in result.stdout, result.stdout


def test_nag_over_default_no_declared_limit() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(120))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "TIGER: NAG 1" in result.stdout, result.stdout
        assert "a.py:1:" in result.stdout, result.stdout
        assert "120 cols" in result.stdout, result.stdout


def test_block_at_env_declared_limit() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(90))
        _git(repo, "add", "a.py")
        result = _run(repo, WHETSTONE_TIGER_COLS="80")
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "TIGER: BLOCK 1" in result.stdout, result.stdout
        assert "limit 80" in result.stdout, result.stdout


def test_env_beats_editorconfig() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*]\nmax_line_length = 200\n")
        _write(repo, "a.py", _line(90))
        _git(repo, "add", "a.py", ".editorconfig")
        result = _run(repo, WHETSTONE_TIGER_COLS="80")
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "limit 80" in result.stdout, result.stdout


def test_editorconfig_section_glob_scopes_by_extension() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 79\n")
        _write(repo, "a.py", _line(90))
        _write(repo, "b.js", _line(90))
        _git(repo, "add", "a.py", "b.js", ".editorconfig")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "a.py:1:" in result.stdout, result.stdout
        assert "b.js" not in result.stdout, result.stdout
        assert "TIGER: BLOCK 1" in result.stdout, result.stdout


def test_editorconfig_off_skips_file() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = off\n")
        _write(repo, "a.py", _line(300))
        _git(repo, "add", "a.py", ".editorconfig")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert "a.py" not in result.stdout, result.stdout


def test_mixed_declared_and_fallback_counts_only_declared() -> None:
    """A fallback offence must never be swept into the BLOCK count."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 88\n")
        _write(repo, "a.py", _line(95))
        _write(repo, "b.sh", _line(120))
        _git(repo, "add", "a.py", "b.sh", ".editorconfig")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "TIGER: BLOCK 1" in result.stdout, result.stdout
        assert "a.py:1: 95 cols (limit 88)" in result.stdout, result.stdout
        assert "b.sh:1: 120 cols (limit 100)" in result.stdout, result.stdout


def test_block_count_sums_multiple_declared_offences() -> None:
    """Pins that BLOCK <n> is a count, not an any-hit flag stuck at 1."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 88\n")
        _write(repo, "a.py", _line(95))
        _write(repo, "b.py", _line(96) + _line(10))
        _write(repo, "c.sh", _line(120))
        _git(repo, "add", "a.py", "b.py", "c.sh", ".editorconfig")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "TIGER: BLOCK 2" in result.stdout, result.stdout
        assert "c.sh:1: 120 cols (limit 100)" in result.stdout, result.stdout


def test_fallback_only_nags_when_editorconfig_does_not_match() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 88\n")
        _write(repo, "b.sh", _line(120))
        _git(repo, "add", "b.sh", ".editorconfig")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "TIGER: NAG 1" in result.stdout, result.stdout


def test_staged_new_file_is_seen() -> None:
    """F19: git diff HEAD is empty when only staged-new files exist."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.txt", "seed\n")
        _git(repo, "add", "seed.txt")
        _commit(repo, "seed")
        _write(repo, "fresh.py", _line(150))
        _git(repo, "add", "fresh.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "fresh.py:1:" in result.stdout, result.stdout


def test_removed_lines_ignored() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(300))
        _git(repo, "add", "a.py")
        _commit(repo, "seed")
        _write(repo, "a.py", _line(10))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_prose_extensions_skipped() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "README.md", _line(400))
        _write(repo, "data.json", _line(400))
        _git(repo, "add", "README.md", "data.json")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_unstaged_change_not_checked() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(10))
        _git(repo, "add", "a.py")
        _commit(repo, "seed")
        _write(repo, "a.py", _line(300))
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_no_staged_changes_is_clean() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(10))
        _git(repo, "add", "a.py")
        _commit(repo, "seed")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_non_repo_exits_64() -> None:
    with tempfile.TemporaryDirectory() as t:
        result = _run(Path(t))
        assert result.returncode == USAGE, result.stdout + result.stderr


def _main() -> int:
    failures = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        try:
            fn()
        except AssertionError as exc:
            failures += 1
            print(f"FAIL {name}: {exc}", file=sys.stderr)
        else:
            print(f"ok {name}")
    if failures:
        print(f"{failures} failing", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
