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


def _verdict(result: subprocess.CompletedProcess[str]) -> str:
    """The verdict line, exactly.

    Substring assertions cannot see a suffix: `"CLEAN 1 file" in stdout` is
    true of `CLEAN 1 files`, so a test named for the singular form passed
    with the singular form mutated away.
    """
    lines = [line for line in result.stdout.splitlines() if line.startswith("TIGER:")]
    return lines[-1] if lines else ""


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
        _write(repo, "b.sh", _line(120))
        _git(repo, "add", "a.py", "b.sh", ".editorconfig")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "a.py" not in result.stdout, result.stdout
        assert "b.sh:1:" in result.stdout, result.stdout


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


def test_editorconfig_above_the_repo_root_is_not_read() -> None:
    """The walk stops at the repo root; a stray parent config must not apply."""
    with tempfile.TemporaryDirectory() as t:
        outer = Path(t)
        (outer / ".editorconfig").write_text(
            "root = true\n\n[*.py]\nmax_line_length = 20\n", encoding="utf-8"
        )
        repo = outer / "inner"
        repo.mkdir()
        _init(repo)
        _write(repo, "src/a.py", _line(120))
        _git(repo, "add", "src/a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "limit 100" in result.stdout, result.stdout


def test_width_exactly_at_the_limit_is_allowed() -> None:
    """Pins <= rather than <: the limit is inclusive."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(100))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_width_one_over_the_limit_is_reported() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(101))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "101 cols" in result.stdout, result.stdout


def test_offence_reports_the_real_line_number() -> None:
    """Every other fixture offends on line 1, so line arithmetic went unpinned."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", "".join(f"short {n}\n" for n in range(20)))
        _git(repo, "add", "a.py")
        _commit(repo, "chore: seed")
        body = ["short %d\n" % n for n in range(20)]
        body[9] = _line(130)
        _write(repo, "a.py", "".join(body))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "a.py:10:" in result.stdout, result.stdout


def test_unborn_head_still_checks_the_index() -> None:
    """`git diff HEAD` fails outright before the first commit; --cached does not."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(120))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "a.py:1:" in result.stdout, result.stdout


def test_pure_rename_adds_nothing() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "old.py", _line(120) * 5)
        _git(repo, "add", "old.py")
        _commit(repo, "chore: seed")
        _git(repo, "mv", "old.py", "new.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_rename_plus_a_long_line_reports_only_the_new_line() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "old.py", _line(120) * 5)
        _git(repo, "add", "old.py")
        _commit(repo, "chore: seed")
        _git(repo, "mv", "old.py", "new.py")
        _write(repo, "new.py", _line(120) * 5 + _line(130))
        _git(repo, "add", "new.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "TIGER: NAG 1" in result.stdout, result.stdout
        assert "130 cols" in result.stdout, result.stdout


def test_nested_editorconfig_brace_and_scoped_glob() -> None:
    """One fixture pinning the chain walk, brace expansion and glob scoping."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*]\nmax_line_length = 200\n")
        _write(repo, "pkg/.editorconfig", "[*.{js,ts}]\nmax_line_length = 60\n")
        _write(repo, "pkg/a.ts", _line(80))
        _write(repo, "pkg/b.py", _line(80))
        _git(repo, "add", ".editorconfig", "pkg/.editorconfig", "pkg/a.ts", "pkg/b.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "pkg/a.ts:1: 80 cols (limit 60)" in result.stdout, result.stdout
        assert "b.py" not in result.stdout, result.stdout


def test_clean_reports_how_many_files_it_examined() -> None:
    """'checked three files, all fine' must not read like 'checked nothing'."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(10))
        _git(repo, "add", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: CLEAN 1 file", result.stdout


def test_nothing_staged_says_zero_files() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(10))
        _git(repo, "add", "a.py")
        _commit(repo, "chore: seed")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: CLEAN 0 files", result.stdout


def test_all_staged_files_skipped_is_not_nothing_staged() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, "README.md", _line(300))
        _write(repo, "data.json", _line(300))
        _git(repo, "add", "README.md", "data.json")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: CLEAN 0 files, 2 skipped", result.stdout


def test_off_declared_file_counts_as_skipped_not_examined() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, ".editorconfig", "[*.py]\nmax_line_length = off\n")
        _write(repo, "wide.py", _line(300))
        _git(repo, "add", ".editorconfig", "wide.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert "1 skipped" in result.stdout, result.stdout


def test_unusable_env_limit_is_announced_not_swallowed() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, "wide.py", _line(150))
        _git(repo, "add", "wide.py")
        result = _run(repo, WHETSTONE_TIGER_COLS="0")
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "WHETSTONE_TIGER_COLS" in result.stderr, result.stderr


def test_unusable_editorconfig_limit_is_announced_not_swallowed() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, ".editorconfig", "[*.py]\nmax_line_length = 0\n")
        _write(repo, "wide.py", _line(150))
        _git(repo, "add", ".editorconfig", "wide.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "max_line_length" in result.stderr, result.stderr


def test_unusable_later_section_does_not_silently_keep_the_earlier_limit() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(
            repo,
            ".editorconfig",
            "[*]\nmax_line_length = 80\n\n[*.py]\nmax_line_length = 0\n",
        )
        _write(repo, "wide.py", _line(150))
        _git(repo, "add", ".editorconfig", "wide.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "limit 80" in result.stdout, result.stdout
        assert "max_line_length" in result.stderr, result.stderr


def test_usable_editorconfig_limit_stays_silent_on_stderr() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, ".editorconfig", "[*.py]\nmax_line_length = 40\n")
        _write(repo, "wide.py", _line(150))
        _git(repo, "add", ".editorconfig", "wide.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "max_line_length" not in result.stderr, result.stderr


def test_usable_env_limit_stays_silent_on_stderr() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        _write(repo, "wide.py", _line(150))
        _git(repo, "add", "wide.py")
        result = _run(repo, WHETSTONE_TIGER_COLS="40")
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "WHETSTONE_TIGER_COLS" not in result.stderr, result.stderr


def test_staged_new_file_is_seen() -> None:
    """A file that exists only in the index is still measured."""
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


def test_content_mimicking_a_file_header_is_not_trusted() -> None:
    """An added line reading '++ b/x.md' becomes '+++ b/x.md' in the diff."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "smuggle.py", "a = 1\n++ b/decoy.md\n" + _line(300))
        _git(repo, "add", "smuggle.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "smuggle.py" in result.stdout, result.stdout
        assert "decoy.md" not in result.stdout, result.stdout


def test_content_mimicking_a_dev_null_header_is_not_trusted() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "smuggle.py", "a = 1\n++ /dev/null\n" + _line(300))
        _git(repo, "add", "smuggle.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "smuggle.py" in result.stdout, result.stdout


def test_non_ascii_filename_still_gets_its_declared_limit() -> None:
    """git quotes and octal-escapes such paths in +++ headers."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 80\n")
        _write(repo, "café.py", _line(96))
        _git(repo, "add", "café.py", ".editorconfig")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "limit 80" in result.stdout, result.stdout


def test_filename_with_a_space_still_checked() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "two words.py", _line(120))
        _git(repo, "add", "two words.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert result.stdout.startswith("two words.py:1:"), result.stdout


def test_unicode_digit_env_limit_does_not_crash() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "a.py", _line(120))
        _git(repo, "add", "a.py")
        result = _run(repo, WHETSTONE_TIGER_COLS="²")
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "Traceback" not in result.stderr, result.stderr


def test_unicode_digit_editorconfig_limit_does_not_crash() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = ²\n")
        _write(repo, "a.py", _line(120))
        _git(repo, "add", "a.py", ".editorconfig")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "Traceback" not in result.stderr, result.stderr


def test_brace_expansion_is_bounded() -> None:
    """2^n expansion must not hang the check."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        groups = "{a,b}" * 22
        _write(
            repo,
            ".editorconfig",
            f"root = true\n\n[{groups}*.py]\nmax_line_length = 80\n",
        )
        _write(repo, "a.py", _line(120))
        _git(repo, "add", "a.py", ".editorconfig")
        result = subprocess.run(
            [sys.executable, str(CHECK), str(repo)],
            capture_output=True,
            text=True,
            timeout=20,
        )
        assert result.returncode in (NAG, BLOCK), result.stdout + result.stderr


def test_editorconfig_negated_bracket_glob() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(
            repo,
            ".editorconfig",
            "root = true\n\n[file[!abc].py]\nmax_line_length = 80\n",
        )
        _write(repo, "filex.py", _line(96))
        _write(repo, "filea.py", _line(96))
        _git(repo, "add", "filex.py", "filea.py", ".editorconfig")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "filex.py" in result.stdout, result.stdout
        assert "TIGER: BLOCK 1" in result.stdout, result.stdout


def test_missing_git_binary_exits_64() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        result = subprocess.run(
            [sys.executable, str(CHECK), str(repo)],
            capture_output=True,
            text=True,
            env={"PATH": str(repo / "no-such-dir")},
        )
        assert result.returncode == USAGE, result.stdout + result.stderr
        assert "Traceback" not in result.stderr, result.stderr


def test_wide_characters_count_two_columns() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "wide.py", "x = " + "文" * 60 + "\n")
        _git(repo, "add", "wide.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "124 cols" in result.stdout, result.stdout


def test_tabs_count_to_the_next_tab_stop() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "tabbed.py", "xxx\t" * 13 + "\n")
        _git(repo, "add", "tabbed.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "104 cols" in result.stdout, result.stdout


SKIPPED_FIXTURES = (
    "a.md",
    "a.markdown",
    "a.rst",
    "a.txt",
    "a.json",
    "a.jsonl",
    "a.csv",
    "a.tsv",
    "a.svg",
    "a.lock",
    "a.snap",
    "go.sum",
    "yarn.lock",
    "poetry.lock",
    "Cargo.lock",
)


def test_every_skipped_kind_is_actually_skipped() -> None:
    """Listed literally, not imported — importing the set would test nothing.

    Only `.md` and `.json` had coverage; dropping any other entry left the
    whole suite green.
    """
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        for name in SKIPPED_FIXTURES:
            _write(repo, name, _line(300))
        _git(repo, "add", *SKIPPED_FIXTURES)
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        expected = f"TIGER: CLEAN 0 files, {len(SKIPPED_FIXTURES)} skipped"
        assert _verdict(result) == expected, result.stdout


def test_combining_marks_do_not_widen_a_line() -> None:
    """100 base characters each carrying a combining mark occupy 100 columns.

    Counting the marks would read 200 and flag a line that renders exactly at
    the limit; no fixture put one near a boundary before.
    """
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "accents.py", "e\u0301" * 100 + "\n")
        _git(repo, "add", "accents.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_filename_with_a_space_keeps_its_declared_limit() -> None:
    """The space-path case was only ever asserted against the fallback."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 40\n")
        _write(repo, "two words.py", _line(90))
        _git(repo, "add", ".editorconfig", "two words.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "two words.py:1: 90 cols (limit 40)" in result.stdout, result.stdout


def test_star_does_not_cross_a_directory_boundary() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(
            repo, ".editorconfig", "root = true\n\n[src/*.py]\nmax_line_length = 40\n"
        )
        _write(repo, "src/a.py", _line(90))
        _write(repo, "src/sub/deep.py", _line(90))
        _git(repo, "add", ".editorconfig", "src/a.py", "src/sub/deep.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "src/a.py:1: 90 cols (limit 40)" in result.stdout, result.stdout
        assert "deep.py" not in result.stdout, result.stdout


def test_question_mark_does_not_match_a_slash() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[a?c.py]\nmax_line_length = 40\n")
        _write(repo, "a/c.py", _line(90))
        _git(repo, "add", ".editorconfig", "a/c.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_bare_glob_still_matches_inside_a_subdirectory() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 40\n")
        _write(repo, "deep/nested/a.py", _line(90))
        _git(repo, "add", ".editorconfig", "deep/nested/a.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "limit 40" in result.stdout, result.stdout


def test_no_newline_marker_is_not_an_added_line() -> None:
    """`\\ No newline at end of file` follows a hunk and starts with neither +/-."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "seed.py", _line(10))
        _git(repo, "add", "seed.py")
        _commit(repo, "chore: seed")
        (repo / "a.py").write_text("x" * 50, encoding="utf-8")
        _git(repo, "add", "a.py")
        result = _run(repo, WHETSTONE_TIGER_COLS="10")
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: BLOCK 1", result.stdout


def test_a_staged_deletion_is_not_examined() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "gone.py", _line(300))
        _git(repo, "add", "gone.py")
        _commit(repo, "chore: seed")
        _git(repo, "rm", "-q", "gone.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: CLEAN 0 files", result.stdout


def test_rename_is_attributed_to_the_new_name() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "old.py", _line(120) * 5)
        _git(repo, "add", "old.py")
        _commit(repo, "chore: seed")
        _git(repo, "mv", "old.py", "new.py")
        _write(repo, "new.py", _line(120) * 5 + _line(130))
        _git(repo, "add", "new.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "new.py:6: 130 cols" in result.stdout, result.stdout
        assert "old.py" not in result.stdout, result.stdout


def test_rename_beside_another_change_loses_neither() -> None:
    """The rename branch consumes three tokens; miscounting eats the next entry."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "old.py", _line(10))
        _write(repo, "other.py", _line(10))
        _git(repo, "add", "old.py", "other.py")
        _commit(repo, "chore: seed")
        _git(repo, "mv", "old.py", "new.py")
        _write(repo, "other.py", _line(10) + _line(140))
        _git(repo, "add", "new.py", "other.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "other.py:2: 140 cols" in result.stdout, result.stdout


def test_rename_pairing_survives_renames_being_off() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _git(repo, "config", "diff.renames", "false")
        _write(repo, "old.py", _line(130) * 5)
        _git(repo, "add", "old.py")
        _commit(repo, "chore: seed")
        _git(repo, "mv", "old.py", "new.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert _verdict(result) == "TIGER: CLEAN 1 file", result.stdout


def test_an_honoured_off_is_never_reported_as_ignored() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = off\n")
        _write(repo, "a.py", _line(300))
        _git(repo, "add", ".editorconfig", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr
        assert "max_line_length" not in result.stderr, result.stderr


def test_fullwidth_characters_count_as_two_columns() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, "wide.py", "Ａ" * 51 + "\n")
        _git(repo, "add", "wide.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "102 cols" in result.stdout, result.stdout


def test_editorconfig_comments_are_not_settings() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(
            repo,
            ".editorconfig",
            "root = true\n\n[*.py]\n; max_line_length = 20\n# max_line_length = 20\nmax_line_length = 40\n",
        )
        _write(repo, "a.py", _line(30))
        _git(repo, "add", ".editorconfig", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_a_setting_outside_any_section_is_not_a_glob() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\nmax_line_length = 20\n")
        _write(repo, "a.py", _line(60))
        _git(repo, "add", ".editorconfig", "a.py")
        result = _run(repo)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_the_root_config_is_reached_past_a_non_root_one() -> None:
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*.py]\nmax_line_length = 40\n")
        _write(repo, "src/.editorconfig", "[*.js]\nmax_line_length = 200\n")
        _write(repo, "src/a.py", _line(90))
        _git(repo, "add", ".editorconfig", "src/.editorconfig", "src/a.py")
        result = _run(repo)
        assert result.returncode == BLOCK, result.stdout + result.stderr
        assert "limit 40" in result.stdout, result.stdout


def test_an_unparseable_section_glob_is_not_read_as_a_block() -> None:
    """`[[!]]` used to splice into `[^]` and raise; the traceback exited 1 —
    the checker's own BLOCK code — so a broken config read as a real offence."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[[!]]\nmax_line_length = 40\n")
        _write(repo, "a.py", _line(120))
        _git(repo, "add", ".editorconfig", "a.py")
        result = _run(repo)
        assert result.returncode == NAG, result.stdout + result.stderr
        assert "TIGER: NAG 1" in result.stdout, result.stdout


def test_a_wildcard_heavy_section_glob_does_not_hang() -> None:
    """Twelve star groups against a long path backtracked for minutes, which is
    a stall on every commit for whoever wrote that `.editorconfig`."""
    with tempfile.TemporaryDirectory() as t:
        repo = Path(t)
        _init(repo)
        glob = "*a" * 12 + "*b"
        _write(
            repo, ".editorconfig", f"root = true\n\n[{glob}]\nmax_line_length = 40\n"
        )
        name = "a" * 120 + ".py"
        _write(repo, name, _line(120))
        _git(repo, "add", ".editorconfig", name)
        env = dict(os.environ)
        env.pop("WHETSTONE_TIGER_COLS", None)
        result = subprocess.run(
            [sys.executable, str(CHECK), str(repo)],
            capture_output=True,
            text=True,
            timeout=20,
            env=env,
        )
        assert result.returncode == NAG, result.stdout + result.stderr


def test_a_subdirectory_root_agrees_with_the_work_tree_top() -> None:
    """git emits diff paths relative to the work-tree top, and they are handed
    back as pathspecs from whatever root was passed. Given a subdirectory the
    two disagreed and every file measured zero added lines — reported not as a
    skip but as `CLEAN 1 file`, so the examined count said it had looked."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _init(repo)
        _write(repo, "sub/wide.py", _line(150))
        _git(repo, "add", "sub/wide.py")
        top = _run(repo)
        nested = _run(repo / "sub")
        assert _verdict(top) == _verdict(nested), (
            f"top={_verdict(top)!r} nested={_verdict(nested)!r}"
        )
        assert top.returncode == nested.returncode, top.stdout + nested.stdout


def test_a_subdirectory_root_still_reads_the_repo_editorconfig() -> None:
    """The declared limit lives at the work-tree top. Resolving the top must
    not leave the config lookup anchored to the subdirectory, or a declared
    limit silently degrades to the advisory fallback."""
    with tempfile.TemporaryDirectory() as tmp:
        repo = Path(tmp) / "repo"
        repo.mkdir()
        _init(repo)
        _write(repo, ".editorconfig", "root = true\n\n[*]\nmax_line_length = 40\n")
        _write(repo, "sub/wide.py", _line(60))
        _git(repo, "add", "sub/wide.py")
        nested = _run(repo / "sub")
        assert _verdict(nested) == "TIGER: BLOCK 1", nested.stdout + nested.stderr
        assert nested.returncode == BLOCK, nested.stdout + nested.stderr


def _main() -> int:
    wanted = ""
    argv = sys.argv[1:]
    if "-k" in argv:
        index = argv.index("-k")
        if index + 1 == len(argv):
            print("-k needs a substring", file=sys.stderr)
            return 1
        wanted = argv[index + 1]
    failures = 0
    selected = 0
    for name, fn in sorted(globals().items()):
        if not name.startswith("test_") or not callable(fn):
            continue
        if wanted and wanted not in name:
            continue
        selected += 1
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
    if wanted and not selected:
        print(f"no test matched {wanted!r}", file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
