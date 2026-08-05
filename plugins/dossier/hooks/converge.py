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
DETAIL_MAX = 120

_ROW = re.compile(r"^\|(.+)\|\s*$")
_SPLIT = re.compile(r"(?<!\\)\|")
_DATE_PREFIX = re.compile(r"^\d{4}-\d{2}-\d{2}-")


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


def _numbered_rows(text: str) -> list[list[str]]:
    """Every done-when row whose id cell is a number, well-formed or not.

    Shape is judged by the caller, never here. A row that lost its `expect` cell
    to a formatter used to be skipped by this parser while the prompt hook still
    counted it, so `MET 1/1` printed for a contract whose second criterion never
    ran. The hook counts through this same function for that reason.
    """
    section = text.split("## done-when", 1)
    if len(section) != 2:
        return []
    body = section[1].split("\n## ", 1)[0]
    return [
        cells
        for line in body.splitlines()
        if (cells := _cells(line)) and cells[0].isdigit()
    ]


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


def _run(command: str, root: Path, depth: int) -> tuple[int, str, str]:
    """Exit code, stdout and stderr, kept apart.

    `_met` reads only the first two. Merging them made `stdout: <text>` match
    text the command sent to stderr, so a wave reported MET on output it never
    printed to stdout, and `stdout: (nothing)` reported UNMET against an empty
    stdout that happened to sit beside a warning. The timeout notice goes in the
    stderr slot so it never reaches a `stdout:` comparison; it still prints on
    the criterion line, and never reaches this process's own stderr.
    """
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
        return 124, "", f"timed out after {TIMEOUT_SECONDS}s"
    return done.returncode, done.stdout, done.stderr


def _detail(stream: str) -> str:
    """The first non-empty line of a failed criterion's stderr, bounded.

    Separating the streams would otherwise throw the diagnostic away and send
    the reader off to re-run the command by hand. The bound keeps one runaway
    command from burying the verdict line under its own output.
    """
    for raw in stream.splitlines():
        line = raw.strip()
        if line:
            return line[:DETAIL_MAX]
    return ""


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
    2026-08-05-guardrails, each reporting MET for a contract of nothing. A
    hyphen-delimited suffix test was the first correction and was still looser
    than this sentence, since it also let `check.md` claim
    2026-08-01-claim-check; equality against the date-stripped name is what the
    sentence says and now what the code does.

    `.dossier/` is the tracked home a repo opts into by creating it; the wave
    directory's own `CONTRACT.md` is the untracked fallback, which dies with
    the wave and can be cited by nobody — its writer was told so at `ds:new`.
    """
    undated = _DATE_PREFIX.sub("", slug)
    folder = root / CONTRACT_DIR
    if folder.is_dir():
        for candidate in sorted(p for p in folder.glob("*.md") if p.is_file()):
            if candidate.stem in (slug, undated):
                return candidate
    fallback = root / ".scratchpad" / "dossier" / slug / "CONTRACT.md"
    if fallback.is_file():
        return fallback
    return None


def _untracked(contract: Path) -> bool:
    """True for the wave-dir home, the one no diff ever showed a reviewer.

    Criteria reach a shell and `ds:close` resolves a contract with no argument,
    so the weaker home is named in the header instead of read silently. This
    reads the home from the filename rather than asking git: `_contract_for`
    only ever returns `CONTRACT.md` from a wave directory, and the header says
    which home won rather than what git currently knows about the file.
    """
    return contract.name == "CONTRACT.md"


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

    rows = _numbered_rows(text)
    if not rows:
        return _fail("no done-when table, or it holds no numbered rows")
    home = " (wave-dir, untracked)" if _untracked(contract) else ""
    print(f"contract: {contract}{home}", flush=True)

    for row in rows:
        if len(row) != 3:
            return _fail(f"criterion {row[0]} is not exactly id | command | expect")
        ident, command, expect = row
        if not _is_command(command):
            return _fail(f"criterion {ident} is not a backticked command: {command!r}")
        if not _EXPECT.fullmatch(expect.strip()):
            return _fail(f"criterion {ident} has an unreadable expect: {expect!r}")

    if not _consumer(text):
        return _fail(f"{contract} names no consumer")

    for ident, command, _ in rows:
        print(f"will run {ident}. {command[1:-1]}")
    sys.stdout.flush()

    root = Path.cwd()
    unmet = 0
    for ident, command, expect in rows:
        bare = command[1:-1]
        code, out, err = _run(bare, root, depth)
        ok = _met(expect, code, out)
        unmet += 0 if ok else 1
        line = f"  {'MET  ' if ok else 'UNMET'} {ident}. {bare}  [{expect}]"
        if not ok and (detail := _detail(err)):
            line += f"  — {detail}"
        print(line)

    if unmet:
        print(f"CONVERGE: UNMET {unmet} of {len(rows)}")
        return UNMET
    print(f"CONVERGE: MET {len(rows)}/{len(rows)}")
    return MET


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
