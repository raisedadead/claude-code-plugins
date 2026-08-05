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


def test_an_agent_noun_subject_is_a_claim() -> None:
    """F25's third recurrence shipped as 'Three rules the runner enforces
    rather than trusts:' — no backticks, so the subject rule never saw it.
    A shipped-machinery noun before the verb is a claim too."""
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "noun.md"
        path.write_text(
            "Three rules the runner enforces rather than trusts:\n\n"
            "The hook blocks a phase marker on sight.\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert _verdict(result) == "CLAIMS: FLAGGED 2", result.stdout + result.stderr
        assert result.returncode == FLAGGED, result.stdout


def test_a_backed_agent_noun_claim_passes() -> None:
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "backed.md"
        path.write_text(
            "The runner refuses a prose criterion at parse time, exit 2.\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_an_indefinite_subject_is_not_a_claim() -> None:
    """The determiner restriction the widening argues for, pinned: honest
    generalisations read with indefinite subjects and must stay unflagged."""
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "general.md"
        path.write_text(
            "A gate that blocks on a signal it cannot back will be disabled "
            "by the operator within a week.\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_a_code_labelled_enforcement_row_passes() -> None:
    """FORMAT.md's verdict grammar labels enforcement `code — <script>`; the
    ledger of honest labels must not be flagged by the tool built from it."""
    with tempfile.TemporaryDirectory() as t:
        path = Path(t) / "row.md"
        path.write_text(
            "| Vm.3 | every x row has a cite | code — `lib-row-flip.sh` "
            "refuses cite-less `x` |\n",
            encoding="utf-8",
        )
        result = _run(path)
        assert result.returncode == CLEAN, result.stdout + result.stderr


def test_an_unknown_option_is_a_usage_error() -> None:
    """Silently dropping `--help` reported CLEAN for a file list the caller
    never gave — the silent-ignore class `tiger_check` already names aloud."""
    result = _run("--help", FIXTURES / "claims-true.md")
    assert result.returncode == USAGE, result.stdout + result.stderr
    assert "--help" in result.stderr, result.stderr


def test_the_wrapper_agrees_with_the_module() -> None:
    direct = _run(FIXTURES / "claims-false.md")
    shell = subprocess.run(
        ["bash", str(WRAPPER), str(FIXTURES / "claims-false.md")],
        capture_output=True,
        text=True,
    )
    assert shell.returncode == direct.returncode, shell.stdout + shell.stderr


WHETSTONE_RUNNERS = (
    Path(__file__).resolve().parent / "test_whetstone_py.py",
    Path(__file__).resolve().parent / "test_tiger_check.py",
    Path(__file__).resolve().parent / "test_claim_check.py",
)


def _runner(path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(path), *args], capture_output=True, text=True
    )


def test_every_runner_refuses_a_k_filter_matching_nothing() -> None:
    """The filter matches nothing on purpose, or a runner spawned here
    re-enters this test once per runner."""
    for runner in WHETSTONE_RUNNERS:
        done = _runner(runner, "-k", "zzz_matches_no_test")
        assert done.returncode == 1, f"{runner.name}: {done.stdout}{done.stderr}"


def test_a_bare_k_is_refused_rather_than_ignored() -> None:
    for runner in WHETSTONE_RUNNERS:
        done = _runner(runner, "-k")
        assert done.returncode == 1, f"{runner.name}: {done.stdout}{done.stderr}"


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
