#!/usr/bin/env python3
"""Default-off fake-implementation backstop (Stop hook, Layer A).

Enabled only when DOSSIER_FAKEIMPL_CMD is set to a project's fast smoke/test
command. On Stop, if the working tree has uncommitted changes, that command
runs; a non-zero exit blocks completion so an unverified "it works" claim can
not stand. Dirty is `git status --porcelain`, so a brand-new untracked file
counts — that is where a fake implementation usually lives, and an earlier
`git diff HEAD` check silently missed the whole class.

`.scratchpad` is excluded. The suite's own hooks write there, and
in a repo that does not gitignore it those writes are untracked, so counting
them would arm this gate on a tree the operator never dirtied. Exclusion is done
by filtering porcelain paths, not by a git pathspec: `:!.scratchpad` anchors to
the directory git runs in, so it misses a nested `.scratchpad` and misses a
root one when the session cwd is a subdirectory, and every ledger path in this
suite is cwd-relative, so both orientations occur. `-uall` is required — git
otherwise collapses a wholly-untracked tree to its top directory, hiding the
`.scratchpad` component the filter matches on. Inert (exit 0) when the var is unset — safe to ship default-off.
This is the ambient backstop for ad-hoc sessions; it never duplicates the
in-covenant run_slice.sh proof that ds:build / whetstone tdd-cycle already give.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys


SCRATCHPAD_DIRNAME = ".scratchpad"


def _is_scratchpad_entry(entry: str) -> bool:
    """True when a porcelain line names a path under any .scratchpad directory."""
    path = entry[3:].strip() if len(entry) > 3 else ""
    if " -> " in path:
        path = path.rsplit(" -> ", 1)[-1]
    path = path.strip().strip('"')
    return SCRATCHPAD_DIRNAME in path.split("/")


def _block(reason: str) -> None:
    print(json.dumps({"decision": "block", "reason": reason}))
    sys.exit(0)


def main() -> None:
    cmd = os.environ.get("DOSSIER_FAKEIMPL_CMD", "").strip()
    if not cmd:
        sys.exit(0)
    try:
        json.load(sys.stdin)
    except (json.JSONDecodeError, ValueError):
        pass
    try:
        changed = subprocess.run(
            ["git", "status", "--porcelain", "-uall"],
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        sys.exit(0)
    dirty = [
        line
        for line in changed.splitlines()
        if line.strip() and not _is_scratchpad_entry(line)
    ]
    if not dirty:
        sys.exit(0)
    try:
        timeout = int(os.environ.get("DOSSIER_FAKEIMPL_TIMEOUT", "120"))
    except ValueError:
        timeout = 120
    try:
        proc = subprocess.run(
            cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired:
        _block(
            f"fake-impl backstop: `{cmd}` timed out after {timeout}s — verify the "
            "change actually runs before finishing, or unset DOSSIER_FAKEIMPL_CMD."
        )
    except OSError:
        sys.exit(0)
    if proc.returncode != 0:
        tail = "\n".join((proc.stdout + proc.stderr).strip().splitlines()[-8:])
        _block(
            f"fake-impl backstop: `{cmd}` failed (exit {proc.returncode}) on a dirty "
            f"tree — the change is not verified:\n{tail}"
        )
    sys.exit(0)


if __name__ == "__main__":
    main()
