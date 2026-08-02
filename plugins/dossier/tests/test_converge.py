#!/usr/bin/env python3
"""Stdlib-only tests for converge.py. Run directly or via pytest."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
CONVERGE = PLUGIN / "hooks" / "converge.py"
WRAPPER = PLUGIN / "hooks" / "lib-converge.sh"
FIXTURES = PLUGIN / "tests" / "fixtures"
REPO = PLUGIN.parent.parent

MET, UNMET, PARSE = 0, 1, 2


def _run(contract: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CONVERGE), str(contract), *extra],
        capture_output=True,
        text=True,
        cwd=REPO,
    )


def _verdict(result: subprocess.CompletedProcess[str]) -> str:
    """The CONVERGE line, or "" when the runner never spoke.

    Exit codes alias: a missing or broken runner makes the interpreter exit 2,
    which is this tool's own parse-failure code. Four tests passed against no
    implementation at all until the verdict line was required.
    """
    for line in result.stdout.splitlines():
        if line.startswith("CONVERGE:"):
            return line
    return ""


def test_all_criteria_met_exits_zero() -> None:
    result = _run(FIXTURES / "met.md")
    assert _verdict(result) == "CONVERGE: MET 5/5", result.stdout + result.stderr
    assert result.returncode == MET, result.stdout + result.stderr


def test_any_criterion_unmet_exits_one() -> None:
    result = _run(FIXTURES / "unmet.md")
    assert _verdict(result) == "CONVERGE: UNMET 2 of 3", result.stdout + result.stderr
    assert result.returncode == UNMET, result.stdout + result.stderr


def test_exit_code_follows_criteria_not_their_count() -> None:
    """V3. The met fixture has more criteria than the unmet one."""
    met = _run(FIXTURES / "met.md")
    unmet = _run(FIXTURES / "unmet.md")
    assert met.returncode == MET, met.stdout
    assert unmet.returncode == UNMET, unmet.stdout


def test_one_line_reported_per_criterion() -> None:
    result = _run(FIXTURES / "met.md")
    reported = [line for line in result.stdout.splitlines() if line.startswith("  ")]
    assert len(reported) == 5, result.stdout


def test_a_non_command_criterion_fails_the_parse() -> None:
    """V2. Prose must never run as a shell command and report met."""
    result = _run(FIXTURES / "prose.md")
    assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout + result.stderr
    assert result.returncode == PARSE, result.stdout + result.stderr


def test_a_contract_without_a_done_when_table_fails_the_parse() -> None:
    result = _run(FIXTURES.parent / "test_converge.py")
    assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout + result.stderr
    assert result.returncode == PARSE, result.stdout + result.stderr


def test_a_missing_contract_fails_the_parse() -> None:
    result = _run(FIXTURES / "no-such-contract.md")
    assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout + result.stderr
    assert result.returncode == PARSE, result.stdout + result.stderr


def test_an_escaped_pipe_survives_the_cell_split() -> None:
    """`printf 'a' \\| cat` is one command, not a truncated one."""
    result = _run(FIXTURES / "met.md")
    assert result.returncode == MET, result.stdout + result.stderr
    assert "| cat" in result.stdout, result.stdout


def test_a_nonzero_expected_exit_counts_as_met() -> None:
    result = _run(FIXTURES / "met.md")
    assert "false" in result.stdout, result.stdout
    assert result.returncode == MET, result.stdout


def test_stdout_nothing_requires_empty_output() -> None:
    result = _run(FIXTURES / "unmet.md")
    assert result.returncode == UNMET, result.stdout
    assert "nope" in result.stdout or "yes" in result.stdout, result.stdout


def test_a_contract_naming_the_runner_is_refused() -> None:
    """A criterion that invokes converge recurses; refuse rather than hang."""
    recursive = FIXTURES / "recursive.md"
    recursive.write_text(
        "# recursive\n\n## done-when\n\n"
        "| id  | command                  | expect |\n"
        "| --- | ------------------------ | ------ |\n"
        "| 1   | `bash hooks/lib-converge.sh x` | exit 0 |\n",
        encoding="utf-8",
    )
    try:
        result = _run(recursive)
        assert _verdict(result).startswith("CONVERGE: PARSE"), (
            result.stdout + result.stderr
        )
        assert result.returncode == PARSE, result.stdout + result.stderr
    finally:
        recursive.unlink()


def test_the_shell_wrapper_agrees_with_the_module() -> None:
    direct = _run(FIXTURES / "met.md")
    viashell = subprocess.run(
        ["bash", str(WRAPPER), str(FIXTURES / "met.md")],
        capture_output=True,
        text=True,
        cwd=REPO,
    )
    assert viashell.returncode == direct.returncode, viashell.stdout + viashell.stderr


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
