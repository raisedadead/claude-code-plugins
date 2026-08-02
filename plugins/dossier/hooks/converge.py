#!/usr/bin/env python3
"""Run a wave contract's done-when criteria and report whether the wave is over.

Exit codes:
  0  every criterion met            (MET)
  1  at least one unmet             (UNMET)
  2  the contract could not be read (PARSE)

Read the `CONVERGE:` line before the exit code. A missing or broken runner makes
the interpreter exit 1 or 2 on its own, which are this tool's own UNMET and
PARSE codes, so a caller reading only the number cannot tell a verdict from a
crash. No `CONVERGE:` line means nothing ran.
"""

from __future__ import annotations

import re
import shlex
import subprocess
import sys
from pathlib import Path

MET, UNMET, PARSE = 0, 1, 2
TIMEOUT_SECONDS = 120
RUNNER_NAMES = ("converge.py", "lib-converge.sh", "ds:converge")

_ROW = re.compile(r"^\|(.+)\|\s*$")
_SPLIT = re.compile(r"(?<!\\)\|")


def _cells(line: str) -> list[str]:
    """Split a markdown row on unescaped pipes, then unescape the rest.

    A command containing a pipe is written `a \\| b` so the table survives; a
    naive split truncates it at the first one and silently runs half a command.
    """
    match = _ROW.match(line.rstrip())
    if not match:
        return []
    return [cell.replace("\\|", "|").strip() for cell in _SPLIT.split(match.group(1))]


def _is_command(text: str) -> bool:
    """A criterion must be a backticked command, never prose.

    Prose that reaches the shell either fails for the wrong reason or, worse,
    succeeds: `the tests should pass` runs `the` and reports whatever that does.
    """
    if not (text.startswith("`") and text.endswith("`") and len(text) > 2):
        return False
    try:
        return bool(shlex.split(text[1:-1]))
    except ValueError:
        return False


def _criteria(text: str) -> list[tuple[str, str, str]]:
    section = text.split("## done-when", 1)
    if len(section) != 2:
        return []
    body = section[1].split("\n## ", 1)[0]
    found: list[tuple[str, str, str]] = []
    for line in body.splitlines():
        cells = _cells(line)
        if len(cells) < 3 or not cells[0].isdigit():
            continue
        found.append((cells[0], cells[1], cells[2]))
    return found


def _met(expect: str, code: int, out: str) -> bool:
    expect = expect.strip()
    if expect.startswith("stdout:"):
        wanted = expect[len("stdout:") :].strip()
        if wanted == "(nothing)":
            return code == 0 and out.strip() == ""
        return code == 0 and wanted in out
    exit_match = re.fullmatch(r"exit\s+(\d+)", expect)
    if exit_match:
        return code == int(exit_match.group(1))
    return False


def _run(command: str, root: Path) -> tuple[int, str]:
    try:
        done = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=root,
            timeout=TIMEOUT_SECONDS,
        )
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {TIMEOUT_SECONDS}s"
    return done.returncode, done.stdout + done.stderr


def _fail(reason: str) -> int:
    print(f"CONVERGE: PARSE — {reason}")
    return PARSE


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        return _fail("usage: converge.py <contract-path>")
    contract = Path(argv[1])
    if not contract.is_file():
        return _fail(f"no contract at {contract}")
    text = contract.read_text(encoding="utf-8", errors="replace")

    criteria = _criteria(text)
    if not criteria:
        return _fail("no done-when table, or it holds no numbered rows")

    for ident, command, expect in criteria:
        if not _is_command(command):
            return _fail(f"criterion {ident} is not a backticked command: {command!r}")
        if any(name in command for name in RUNNER_NAMES):
            return _fail(f"criterion {ident} invokes the runner, which recurses")
        if not _met(expect, 0, "") and not re.fullmatch(
            r"(exit\s+\d+|stdout:.*)", expect.strip()
        ):
            return _fail(f"criterion {ident} has an unreadable expect: {expect!r}")

    root = Path.cwd()
    unmet = 0
    for ident, command, expect in criteria:
        bare = command[1:-1]
        code, out = _run(bare, root)
        ok = _met(expect, code, out)
        unmet += 0 if ok else 1
        print(f"  {'MET  ' if ok else 'UNMET'} {ident}. {bare}  [{expect}]")

    if unmet:
        print(f"CONVERGE: UNMET {unmet} of {len(criteria)}")
        return UNMET
    print(f"CONVERGE: MET {len(criteria)}/{len(criteria)}")
    return MET


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
