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


def _consumer(text: str) -> bool:
    """A contract names who the work reaches, or it is refused.

    The field nobody writes unprompted: a wave once hardened a checker through
    three review rounds while no consumer could execute it. Prose calling the
    field mandatory shipped before anything read it — this makes the claim true.
    """
    for line in text.splitlines():
        cells = _cells(line)
        if len(cells) >= 2 and cells[0].lower() == "consumer" and cells[1]:
            return True
    return False


_EXPECT = re.compile(r"exit\s+\d+|stdout:\s*\S.*")


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


def _contract_for(root: Path, slug: str) -> Path | None:
    """The contract belonging to one named wave, keyed on its directory name.

    Sorting picked a closed wave's contract the first time two shared a date,
    and the prompt hook keyed on a title two waves can share — both defects
    were fixed separately with different algorithms, so the hook now imports
    this function instead of transcribing it. The match is the full stem, or
    the stem as the slug's own name with its date prefix dropped: a bare
    suffix test let `s.md` claim wave 2026-08-05-rails and `rails.md` claim
    2026-08-05-guardrails, each reporting MET for a contract of nothing.

    `.dossier/` is the tracked home a repo opts into by creating it; the wave
    directory's own `CONTRACT.md` is the untracked fallback, which dies with
    the wave and can be cited by nobody — its writer was told so at `ds:new`.
    """
    folder = root / CONTRACT_DIR
    if folder.is_dir():
        for candidate in sorted(p for p in folder.glob("*.md") if p.is_file()):
            if candidate.stem == slug or slug.endswith("-" + candidate.stem):
                return candidate
    fallback = root / ".scratchpad" / "dossier" / slug / "CONTRACT.md"
    if fallback.is_file():
        return fallback
    return None


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
        root = Path.cwd()
        slugs = _live_slugs(root)
        if not slugs:
            return _fail(
                "no live wave under .scratchpad/dossier/ — a closed wave's"
                " contract runs only by explicit path"
            )
        found = next((c for s in slugs if (c := _contract_for(root, s))), None)
        if found is None:
            return _fail(f"live wave {slugs[0]} has no contract — ds:new writes one")
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
        if not _EXPECT.fullmatch(expect.strip()):
            return _fail(f"criterion {ident} has an unreadable expect: {expect!r}")

    if not _consumer(text):
        return _fail(f"{contract} names no consumer")

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
