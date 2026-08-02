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

import os
import re
import shlex
import subprocess
import sys
from pathlib import Path

MET, UNMET, PARSE = 0, 1, 2
TIMEOUT_SECONDS = 120
CONTRACT_DIR = ".dossier"
DEPTH_VAR = "DS_CONVERGE_DEPTH"
MAX_DEPTH = 2

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


def _run(command: str, root: Path, depth: int) -> tuple[int, str]:
    child = dict(os.environ)
    child[DEPTH_VAR] = str(depth + 1)
    try:
        done = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            cwd=root,
            timeout=TIMEOUT_SECONDS,
            env=child,
        )
    except subprocess.TimeoutExpired:
        return 124, f"timed out after {TIMEOUT_SECONDS}s"
    return done.returncode, done.stdout + done.stderr


def _fail(reason: str) -> int:
    print(f"CONVERGE: PARSE — {reason}")
    return PARSE


LEDGER_GLOB = ".scratchpad/dossier/*/DOSSIER.md"


def _live_slugs(root: Path) -> list[str]:
    found: list[str] = []
    for ledger in sorted(root.glob(LEDGER_GLOB)):
        try:
            head = ledger.read_text(encoding="utf-8", errors="replace")[:400]
        except OSError:
            continue
        if "`live`" in head:
            found.append(ledger.parent.name)
    return found


def _default_contract(root: Path) -> Path | None:
    """The live wave's contract, never the alphabetically last one.

    Sorting picked a closed wave's contract the first time two shared a date,
    and ran its criteria instead. The prompt hook had the same defect; fixing
    one and leaving the twin is the shape this repo keeps catching.
    """
    folder = root / CONTRACT_DIR
    if not folder.is_dir():
        return None
    contracts = sorted(p for p in folder.glob("*.md") if p.is_file())
    for slug in _live_slugs(root):
        for candidate in contracts:
            if slug.endswith(candidate.stem) or candidate.stem.endswith(slug):
                return candidate
    return contracts[-1] if contracts else None


def _depth() -> int:
    """How many converge runs are already on the stack.

    A criterion may legitimately invoke the runner — this runner's own contract
    tests it against fixtures. What must not happen is unbounded nesting, and no
    reading of the command string decides that reliably: `shellcheck lib-converge.sh`
    names it without running it, and `test_converge.py` merely contains its name.
    Counting actual invocations does decide it.
    """
    try:
        return max(0, int(os.environ.get(DEPTH_VAR, "0")))
    except ValueError:
        return 0


def main(argv: list[str]) -> int:
    depth = _depth()
    if depth >= MAX_DEPTH:
        return _fail(f"converge nested {depth} deep; refusing to recurse further")
    if len(argv) < 2:
        found = _default_contract(Path.cwd())
        if found is None:
            return _fail("no contract given and none found under .dossier/")
        contract = found
    else:
        contract = Path(argv[1])
    if not contract.is_file():
        return _fail(f"no contract at {contract}")
    text = contract.read_text(encoding="utf-8", errors="replace")

    criteria = _criteria(text)
    if not criteria:
        return _fail("no done-when table, or it holds no numbered rows")
    print(f"contract: {contract}")

    for ident, command, expect in criteria:
        if not _is_command(command):
            return _fail(f"criterion {ident} is not a backticked command: {command!r}")
        if not _met(expect, 0, "") and not re.fullmatch(
            r"(exit\s+\d+|stdout:.*)", expect.strip()
        ):
            return _fail(f"criterion {ident} has an unreadable expect: {expect!r}")

    root = Path.cwd()
    unmet = 0
    for ident, command, expect in criteria:
        bare = command[1:-1]
        code, out = _run(bare, root, depth)
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
