#!/usr/bin/env python3
"""Stdlib-only tests for converge.py. Run directly or via pytest."""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

PLUGIN = Path(__file__).resolve().parent.parent
CONVERGE = PLUGIN / "hooks" / "converge.py"
WRAPPER = PLUGIN / "hooks" / "lib-converge.sh"
FIXTURES = PLUGIN / "tests" / "fixtures"
REPO = PLUGIN.parent.parent

MET, UNMET, PARSE = 0, 1, 2


def _clean_env() -> dict[str, str]:
    """Drop the depth counter the parent may have set.

    converge exports DS_CONVERGE_DEPTH to every child it runs, not only to
    nested converge calls. Running this suite as a contract criterion therefore
    starts it one level down, and the nesting tests hit a cap they never set.
    """
    env = dict(os.environ)
    env.pop("DS_CONVERGE_DEPTH", None)
    return env


def _run(contract: Path, *extra: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CONVERGE), str(contract), *extra],
        capture_output=True,
        text=True,
        cwd=REPO,
        env=_clean_env(),
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


def test_a_criterion_pointed_at_another_contract_is_allowed() -> None:
    """Naming the runner is fine; the runner's own contract tests it on fixtures."""
    sibling = FIXTURES / "sibling.md"
    sibling.write_text(
        "# sibling\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
        "## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        "| 1   | `bash plugins/dossier/hooks/lib-converge.sh "
        "plugins/dossier/tests/fixtures/met.md` | exit 0 |\n",
        encoding="utf-8",
    )
    try:
        result = _run(sibling)
        assert _verdict(result) == "CONVERGE: MET 1/1", result.stdout + result.stderr
    finally:
        sibling.unlink()


def test_a_name_containing_the_runner_is_not_the_runner() -> None:
    """`test_converge.py` is not `converge.py`; substring matching said it was."""
    lookalike = FIXTURES / "lookalike.md"
    lookalike.write_text(
        "# lookalike\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
        "## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        "| 1   | `test -f plugins/dossier/tests/test_converge.py` | exit 0 |\n",
        encoding="utf-8",
    )
    try:
        result = _run(lookalike)
        assert _verdict(result) == "CONVERGE: MET 1/1", result.stdout + result.stderr
    finally:
        lookalike.unlink()


def test_a_self_referencing_contract_terminates() -> None:
    """The invariant is termination, not refusal. Depth is counted, not guessed."""
    loop = FIXTURES / "loop.md"
    loop.write_text(
        "# loop\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
        "## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        "| 1   | `python3 plugins/dossier/hooks/converge.py "
        "plugins/dossier/tests/fixtures/loop.md` | exit 0 |\n",
        encoding="utf-8",
    )
    try:
        result = subprocess.run(
            [sys.executable, str(CONVERGE), str(loop)],
            capture_output=True,
            text=True,
            cwd=REPO,
            timeout=60,
            env=_clean_env(),
        )
        assert result.returncode in (UNMET, PARSE), result.stdout + result.stderr
    finally:
        loop.unlink()


def test_nesting_past_the_cap_is_refused() -> None:
    env = _clean_env()
    env["DS_CONVERGE_DEPTH"] = "2"
    result = subprocess.run(
        [sys.executable, str(CONVERGE), str(FIXTURES / "met.md")],
        capture_output=True,
        text=True,
        cwd=REPO,
        env=env,
    )
    assert "refusing to recurse" in result.stdout, result.stdout
    assert result.returncode == PARSE, result.stdout


def test_one_level_of_nesting_is_allowed() -> None:
    """Criteria 1 and 2 of this runner's own contract do exactly this."""
    nested = FIXTURES / "nested.md"
    nested.write_text(
        "# nested\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
        "## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        "| 1   | `python3 plugins/dossier/hooks/converge.py "
        "plugins/dossier/tests/fixtures/met.md` | exit 0 |\n",
        encoding="utf-8",
    )
    try:
        result = _run(nested)
        assert _verdict(result) == "CONVERGE: MET 1/1", result.stdout + result.stderr
    finally:
        nested.unlink()


def test_the_shell_wrapper_agrees_with_the_module() -> None:
    direct = _run(FIXTURES / "met.md")
    viashell = subprocess.run(
        ["bash", str(WRAPPER), str(FIXTURES / "met.md")],
        capture_output=True,
        text=True,
        cwd=REPO,
        env=_clean_env(),
    )
    assert viashell.returncode == direct.returncode, viashell.stdout + viashell.stderr


def test_the_default_contract_is_the_live_wave_not_the_last_sorted() -> None:
    """Selecting by sort order ran a closed wave's contract. Twice."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / ".dossier").mkdir()
        body = (
            "# {slug}\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command | expect |\n"
            "| --- | ------- | ------ |\n"
            "| 1   | `true`  | exit 0 |\n"
        )
        (root / ".dossier" / "2026-08-01-aaa-live.md").write_text(
            body.format(slug="aaa-live"), encoding="utf-8"
        )
        (root / ".dossier" / "2026-08-01-zzz-closed.md").write_text(
            body.format(slug="zzz-closed"), encoding="utf-8"
        )
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-aaa-live"
        wave.mkdir(parents=True)
        (wave / "DOSSIER.md").write_text(
            "\n".join(["# aaa-live", "", "`2026-08-01` · `live` · `P1/1`", ""]),
            encoding="utf-8",
        )
        result = subprocess.run(
            [sys.executable, str(CONVERGE)],
            capture_output=True,
            text=True,
            cwd=root,
            env=_clean_env(),
        )
        assert "aaa-live" in result.stdout, result.stdout
        assert "zzz-closed" not in result.stdout, result.stdout


def _wave(root: Path, dirname: str, state: str = "live", goal: str = "") -> None:
    wave = root / ".scratchpad" / "dossier" / dirname
    wave.mkdir(parents=True, exist_ok=True)
    (wave / "DOSSIER.md").write_text(
        "\n".join(
            [
                f"# {dirname[11:]}",
                "",
                f"`2026-08-01` · `{state}` · `P1/1`",
                "",
                "## Goal",
                "",
                goal,
                "",
            ]
        ),
        encoding="utf-8",
    )


def _contract_text(criterion: str = "`true`  | exit 0") -> str:
    return (
        "# c\n\n| field | value |\n| --- | --- |\n| consumer | tests |\n\n"
        "## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        f"| 1   | {criterion} |\n"
    )


def _run_noarg(root: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(CONVERGE)],
        capture_output=True,
        text=True,
        cwd=root,
        env=_clean_env(),
    )


def test_a_wave_dir_contract_is_found_without_a_dossier_dir() -> None:
    """A repo that never opted into tracking still converges."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-01-solo")
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-solo"
        (wave / "CONTRACT.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout + result.stderr


def test_the_tracked_contract_wins_over_the_wave_dir_copy() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-01-solo")
        wave = root / ".scratchpad" / "dossier" / "2026-08-01-solo"
        (wave / "CONTRACT.md").write_text(
            _contract_text("`false` | exit 0"), encoding="utf-8"
        )
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-01-solo.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout


def test_no_live_wave_yields_parse_not_a_closed_contract() -> None:
    """Running a finished wave's contract reported MET on a dead objective."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-01-done.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert "live wave" in _verdict(result), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_live_wave_without_a_contract_is_a_parse() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-01-bare")
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert "2026-08-01-bare" in _verdict(result), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_paused_wave_whose_prose_says_live_is_not_live() -> None:
    """Liveness is the header state token, never a substring of the ledger.

    `"`live`" in head` returned a paused wave whose Goal happened to say
    `live`, and no-arg converge then ran that wave's criteria as shell.
    """
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails", "paused", "Get the `live` count right.")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-05-rails.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert "live wave" in _verdict(result), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_live_wave_whose_prose_says_paused_still_converges() -> None:
    """The other direction: prose naming another state does not unmake a wave."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails", "live", "Stop reading `paused` as prose.")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-05-rails.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout + result.stderr
        assert result.returncode == MET, result.stdout


def test_a_same_slug_successor_selects_the_live_wave() -> None:
    """Predecessor and successor share a slug; only the live dir decides."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "2026-08-01-rails.md").write_text(
            _contract_text("`false` | exit 0"), encoding="utf-8"
        )
        (root / ".dossier" / "2026-08-05-rails.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert "2026-08-05-rails" in result.stdout, result.stdout
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout


def test_a_single_char_stem_does_not_match_an_unrelated_wave() -> None:
    """`s.md` once matched wave 2026-08-05-rails by suffix and reported MET
    against a contract belonging to nothing."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "s.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_shared_suffix_does_not_match_across_slugs() -> None:
    """`rails.md` is not the contract of wave 2026-08-05-guardrails."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-guardrails")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "rails.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_an_undated_contract_name_still_matches_its_own_wave() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "rails.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout


def test_an_archived_contract_is_not_resolved() -> None:
    """Retirement (close step 7.5) depends on `_archive/` staying invisible to
    the resolver; a later switch to a recursive glob would break it silently."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-05-rails")
        archive = root / ".dossier" / "_archive"
        archive.mkdir(parents=True)
        (archive / "2026-08-05-rails.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_contract_without_a_consumer_fails_the_parse() -> None:
    """`consumer` is the field nobody writes unprompted, so prose alone never
    gets it written — the runner refuses a contract that omits it."""
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "no-consumer.md"
        contract.write_text(
            "# c\n\n## done-when\n\n"
            "| id  | command | expect |\n"
            "| --- | ------- | ------ |\n"
            "| 1   | `true`  | exit 0 |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        verdict = _verdict(result)
        assert verdict.startswith("CONVERGE: PARSE"), result.stdout + result.stderr
        assert "consumer" in verdict, result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_consumer_row_with_an_empty_value_fails_the_parse() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "blank-consumer.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer |       |\n\n"
            "## done-when\n\n"
            "| id  | command | expect |\n"
            "| --- | ------- | ------ |\n"
            "| 1   | `true`  | exit 0 |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_an_empty_stdout_expect_fails_the_parse() -> None:
    """A bare `stdout:` matches every output — `"" in anything` is true — so a
    criterion carrying it reports MET on any command that exits 0."""
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "empty-expect.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command              | expect  |\n"
            "| --- | -------------------- | ------- |\n"
            "| 1   | `echo totally-wrong` | stdout: |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def _malformed(row: str) -> subprocess.CompletedProcess[str]:
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "malformed.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command | expect |\n"
            "| --- | ------- | ------ |\n"
            "| 1   | `true`  | exit 0 |\n" + row,
            encoding="utf-8",
        )
        return _run(contract)


def test_a_numbered_row_missing_a_cell_fails_the_parse() -> None:
    """A criterion whose `expect` cell is gone reported MET on the rows that
    survived, so a wave was declared over on a criterion that never ran."""
    result = _malformed("| 2   | `false` |\n")
    verdict = _verdict(result)
    assert verdict.startswith("CONVERGE: PARSE"), result.stdout + result.stderr
    assert "2" in verdict, result.stdout
    assert result.returncode == PARSE, result.stdout


def test_a_numbered_row_with_an_extra_cell_fails_the_parse() -> None:
    """An unescaped pipe splits one command into two cells. This shape was
    already refused for not being backticked; the row-shape gate names it."""
    result = _malformed("| 2   | `echo a | cat` | exit 0 |\n")
    assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
    assert "not exactly id | command | expect" in _verdict(result), result.stdout
    assert result.returncode == PARSE, result.stdout


def test_the_prompt_hook_counts_the_rows_this_runner_refuses() -> None:
    """The hook counts a row the runner will refuse, so no row is counted by one
    and skipped by the other — which is how `MET 1/1` printed for two criteria."""
    sys.path.insert(0, str(PLUGIN / "hooks"))
    from converge import _numbered_rows
    from convergence_state import _criteria_count

    text = (
        "# c\n\n## done-when\n\n"
        "| id  | command | expect |\n"
        "| --- | ------- | ------ |\n"
        "| 1   | `true`  | exit 0 |\n"
        "| 2   | `false` |\n"
    )
    assert len(_numbered_rows(text)) == 2
    assert _criteria_count(text) == 2


def test_a_matching_substring_with_a_failed_command_is_unmet() -> None:
    """Right text, failed command. `stdout:` carries an exit-zero conjunct and
    nothing pinned it."""
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "loud-failure.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command                        | expect        |\n"
            "| --- | ----------------------------- | ------------- |\n"
            "| 1   | `sh -c 'echo hello; exit 3'`  | stdout: hello |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        assert _verdict(result) == "CONVERGE: UNMET 1 of 1", result.stdout
        assert result.returncode == UNMET, result.stdout


def test_stdout_nothing_with_a_failed_command_is_unmet() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "silent-failure.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command        | expect            |\n"
            "| --- | -------------- | ----------------- |\n"
            "| 1   | `sh -c 'exit 3'` | stdout: (nothing) |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        assert _verdict(result) == "CONVERGE: UNMET 1 of 1", result.stdout
        assert result.returncode == UNMET, result.stdout


def test_the_plan_block_reaches_a_pipe_while_the_run_is_still_going() -> None:
    """Ordering in the buffer is not ordering for the reader. Python block-
    buffers stdout when it is not a terminal, and every caller here reads a
    pipe, so without a flush the block a reader is told to read arrives after
    every command has already run."""
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "slow.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command           | expect |\n"
            "| --- | ----------------- | ------ |\n"
            "| 1   | `sh -c 'sleep 4'` | exit 0 |\n",
            encoding="utf-8",
        )
        env = _clean_env()
        env.pop("PYTHONUNBUFFERED", None)
        started = time.perf_counter()
        proc = subprocess.Popen(
            [sys.executable, str(CONVERGE), str(contract)],
            stdout=subprocess.PIPE,
            text=True,
            cwd=REPO,
            env=env,
        )
        planned: float | None = None
        try:
            assert proc.stdout is not None
            while True:
                line = proc.stdout.readline()
                if not line:
                    break
                if line.startswith("will run "):
                    planned = time.perf_counter() - started
                    break
        finally:
            proc.stdout.close() if proc.stdout else None
            proc.wait(timeout=30)
        assert planned is not None, "no will-run line"
        assert planned < 2.0, f"plan block arrived after {planned:.2f}s"


def test_every_command_is_named_before_the_first_one_runs() -> None:
    """A contract's criteria are shell, and `ds:close` resolves one with no
    argument. The commands are printed as a block first so a reader sees what
    is about to run rather than reconstructing it afterwards."""
    result = _run(FIXTURES / "met.md")
    lines = result.stdout.splitlines()
    planned = [i for i, line in enumerate(lines) if line.startswith("will run ")]
    ran = [i for i, line in enumerate(lines) if line.startswith(("  MET", "  UNMET"))]
    assert len(planned) == len(ran) == 5, result.stdout
    assert max(planned) < min(ran), result.stdout


def test_stderr_does_not_satisfy_a_stdout_expect() -> None:
    """`stdout:` names stdout. The runner merged both streams, so a command
    that printed only to stderr reported MET and declared a wave over on text
    it never wrote to stdout."""
    result = _run(FIXTURES / "stderr-only.md")
    assert _verdict(result) == "CONVERGE: UNMET 1 of 1", result.stdout + result.stderr
    assert result.returncode == UNMET, result.stdout + result.stderr


def test_stdout_nothing_ignores_a_noisy_stderr() -> None:
    """The negative space of the same defect: a command whose stdout is empty
    satisfies `stdout: (nothing)` however loud its stderr was. Merging the
    streams failed this one in the opposite direction."""
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "noisy-but-silent.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command                   | expect            |\n"
            "| --- | ------------------------- | ----------------- |\n"
            "| 1   | `sh -c 'echo noise >&2'`  | stdout: (nothing) |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        assert _verdict(result) == "CONVERGE: MET 1/1", result.stdout + result.stderr
        assert result.returncode == MET, result.stdout + result.stderr


def test_a_failed_criterion_reports_its_stderr() -> None:
    """Separating the streams must not lose the diagnostic.

    The expected text must not appear in the command, or the assertion passes
    on the `will run` echo alone — the first draft asserted a marker it had put
    in the command itself and passed against no implementation.
    """
    with tempfile.TemporaryDirectory() as tmp:
        contract = Path(tmp) / "diagnostic.md"
        contract.write_text(
            "# c\n\n| field    | value |\n| -------- | ----- |\n| consumer | tests |\n\n"
            "## done-when\n\n"
            "| id  | command                       | expect |\n"
            "| --- | ----------------------------- | ------ |\n"
            "| 1   | `cat /nonexistent-xyz-marker` | exit 0 |\n",
            encoding="utf-8",
        )
        result = _run(contract)
        reported = [ln for ln in result.stdout.splitlines() if ln.startswith("  UNMET")]
        assert len(reported) == 1, result.stdout
        assert "No such file" in reported[0], result.stdout


def test_a_hyphen_boundary_does_not_match_across_slugs() -> None:
    """`check.md` is not the contract of wave 2026-08-01-claim-check. The
    resolver accepted any hyphen-delimited suffix while its docstring claimed
    equality against the date-stripped slug, so unrelated waves resolved to one
    contract."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-01-claim-check")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "check.md").write_text(_contract_text(), encoding="utf-8")
        result = _run_noarg(root)
        assert _verdict(result).startswith("CONVERGE: PARSE"), result.stdout
        assert result.returncode == PARSE, result.stdout


def test_a_date_stripped_name_still_matches_its_own_wave() -> None:
    """The positive space of the same rule: the stem equal to the slug with its
    date prefix dropped is exactly the match the docstring promises."""
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        _wave(root, "2026-08-01-claim-check")
        (root / ".dossier").mkdir()
        (root / ".dossier" / "claim-check.md").write_text(
            _contract_text(), encoding="utf-8"
        )
        result = _run_noarg(root)
        assert "CONVERGE: MET 1/1" in result.stdout, result.stdout


DOSSIER_RUNNERS = (
    PLUGIN / "hooks" / "test_python.py",
    PLUGIN / "tests" / "test_converge.py",
    PLUGIN / "tests" / "test_convergence_state.py",
)


def _runner(path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(path), *args],
        capture_output=True,
        text=True,
        cwd=REPO,
        env=_clean_env(),
    )


def test_every_runner_refuses_a_k_filter_matching_nothing() -> None:
    """One runner honoured `-k` and the rest accepted and ignored it, so a
    contract criterion naming a test that does not exist reported success.

    The filter matches nothing on purpose: a runner spawned here must select no
    tests, or this test re-enters itself once per runner.
    """
    for runner in DOSSIER_RUNNERS:
        done = _runner(runner, "-k", "zzz_matches_no_test")
        assert done.returncode == 1, f"{runner.name}: {done.stdout}{done.stderr}"


def test_a_k_filter_that_matches_runs_only_the_named_test() -> None:
    """The shape a shipped contract already uses."""
    done = _runner(DOSSIER_RUNNERS[2], "-k", "contractless")
    assert done.returncode == 0, done.stdout + done.stderr
    ran = [line for line in done.stdout.splitlines() if line.startswith("ok test_")]
    assert ran, done.stdout
    assert all("contractless" in line for line in ran), done.stdout
    everything = _runner(DOSSIER_RUNNERS[2])
    all_ran = [ln for ln in everything.stdout.splitlines() if ln.startswith("ok test_")]
    assert len(ran) < len(all_ran), f"filtered={len(ran)} unfiltered={len(all_ran)}"


def test_a_bare_k_is_refused_rather_than_ignored() -> None:
    for runner in DOSSIER_RUNNERS:
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
