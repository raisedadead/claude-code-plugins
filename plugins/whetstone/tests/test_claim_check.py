#!/usr/bin/env python3
"""Stdlib-only tests for claim_check.py. Run directly or via pytest."""

from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
CHECK = PLUGIN / "skills" / "skill-smith" / "scripts" / "claim_check.py"
WRAPPER = PLUGIN / "bin" / "claim-check"
FIXTURES = PLUGIN / "tests" / "fixtures"

CLEAN, FLAGGED, USAGE = 0, 1, 64


def _run(*paths: Path | str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CHECK), *[str(p) for p in paths]],
        capture_output=True,
        text=True,
    )


def _verdict(result: subprocess.CompletedProcess[str]) -> str:
    for line in result.stdout.splitlines():
        if line.startswith("CLAIMS:"):
            return line
    return ""


def test_an_unbacked_claim_is_flagged() -> None:
    result = _run(FIXTURES / "claims-false.md")
    assert _verdict(result).startswith("CLAIMS: FLAGGED"), result.stdout + result.stderr
    assert result.returncode == FLAGGED, result.stdout


def test_every_unbacked_claim_in_the_file_is_named() -> None:
    result = _run(FIXTURES / "claims-false.md")
    assert _verdict(result) == "CLAIMS: FLAGGED 3", result.stdout


def test_a_claim_naming_an_exit_code_passes() -> None:
    result = _run(FIXTURES / "claims-true.md")
    assert _verdict(result) == "CLAIMS: CLEAN 1 file", result.stdout + result.stderr
    assert result.returncode == CLEAN, result.stdout


def test_a_claim_labelled_advisory_passes() -> None:
    result = _run(FIXTURES / "claims-labelled.md")
    assert _verdict(result) == "CLAIMS: CLEAN 1 file", result.stdout + result.stderr
    assert result.returncode == CLEAN, result.stdout


def test_prose_without_the_verbs_is_never_flagged() -> None:
    result = _run(FIXTURES / "claims-quiet.md")
    assert result.returncode == CLEAN, result.stdout + result.stderr


def test_a_verb_without_a_backticked_token_is_not_a_claim() -> None:
    """False positives get the check deleted, so prose about the world is ignored."""
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "prose.md"
        path.write_text(
            "The operator blocks the push. A firewall denies the request.\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_the_offending_line_is_reported_with_its_location() -> None:
    result = _run(FIXTURES / "claims-false.md")
    assert "claims-false.md:3:" in result.stdout, result.stdout


def test_several_files_are_summed() -> None:
    result = _run(FIXTURES / "claims-false.md", FIXTURES / "claims-true.md")
    assert _verdict(result) == "CLAIMS: FLAGGED 3", result.stdout


def test_a_clean_run_counts_the_files_examined() -> None:
    result = _run(FIXTURES / "claims-true.md", FIXTURES / "claims-quiet.md")
    assert _verdict(result) == "CLAIMS: CLEAN 2 files", result.stdout


def test_no_paths_is_a_usage_error() -> None:
    result = _run()
    assert result.returncode == USAGE, result.stdout + result.stderr


def test_a_missing_file_is_a_usage_error_not_a_pass() -> None:
    result = _run(FIXTURES / "no-such-file.md")
    assert result.returncode == USAGE, result.stdout + result.stderr


def test_nouns_and_adjectives_are_not_claims() -> None:
    """ "doubt gate", "env-gated", "write-time gates" are not enforcement claims.

    Matching bare verbs flagged 113 lines in this repo, almost all of them
    these. The subject has to be a backticked name and the verb has to follow.
    """
    result = _run(FIXTURES / "claims-quiet.md")
    assert result.returncode == CLEAN, result.stdout + result.stderr


def test_a_table_row_keeps_its_evidence_cell() -> None:
    """Splitting a row on sentence ends severs a claim from its own source."""
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "table.md"
        path.write_text(
            "| id | fact | source |\n| -- | ---- | ------ |\n"
            "| F1 | `disallowed-tools` enforces at the tool layer. "
            "| anthropics/claude-code#37683 |\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_the_wrapper_agrees_with_the_module() -> None:
    direct = _run(FIXTURES / "claims-false.md")
    shell = subprocess.run(
        ["bash", str(WRAPPER), str(FIXTURES / "claims-false.md")],
        capture_output=True,
        text=True,
    )
    assert shell.returncode == direct.returncode, shell.stdout + shell.stderr


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
