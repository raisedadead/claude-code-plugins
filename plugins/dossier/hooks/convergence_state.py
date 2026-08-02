#!/usr/bin/env python3
"""UserPromptSubmit hook: put the wave's convergence state beside the prompt.

`UserPromptSubmit` is one of three events whose stdout is added as context the
model can see and act on, so an instruction arrives carrying the state of the
objective instead of being evaluated alone. That is the whole point: an
instruction like "review it again" is answerable only next to a contract and a
trend.

Reports git-derived state only. Running the contract's criteria here would put
their whole cost on every prompt, so the verdict stays with `ds:converge` and
this reports what is cheap: how much budget is spent, and which layer recent
work actually touched.

Silence is the default. No contract, no git, no readable state — print nothing
and exit 0. This runs in every repo where the plugin is installed, and someone
who never asked for it pays for anything it gets wrong.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from converge import _cells, _contract_for, _live_slugs, _numbered_rows

GIT_TIMEOUT = 5

RUNTIME_SUFFIXES = (".py", ".sh", ".js", ".ts", ".go", ".rs", ".rb")
DOC_SUFFIXES = (".md", ".json", ".txt", ".yml", ".yaml")


def _git(root: Path, *args: str) -> str:
    try:
        done = subprocess.run(
            ["git", *args],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=GIT_TIMEOUT,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return done.stdout if done.returncode == 0 else ""


def _criteria_count(text: str) -> int:
    """Rows the runner will judge, counted by the runner's own predicate.

    Counting here and parsing there once diverged: a row missing its `expect`
    cell was counted as a criterion and skipped as one.
    """
    return len(_numbered_rows(text))


def _field(text: str, name: str) -> str:
    for line in text.splitlines():
        cells = _cells(line)
        if len(cells) >= 2 and cells[0].lower() == name:
            return cells[1]
    return ""


def _layer_mix(root: Path, since: str) -> str:
    span = f"{since}..HEAD" if since else "HEAD"
    raw = _git(root, "diff", "--numstat", span)
    if not raw.strip():
        return ""
    runtime = docs = tests = 0
    for line in raw.splitlines():
        parts = line.split("\t")
        if len(parts) != 3 or not parts[0].isdigit() or not parts[1].isdigit():
            continue
        changed = int(parts[0]) + int(parts[1])
        path = parts[2]
        suffix = Path(path).suffix.lower()
        if "test" in path:
            tests += changed
        elif suffix in RUNTIME_SUFFIXES:
            runtime += changed
        elif suffix in DOC_SUFFIXES:
            docs += changed
    return f"  lines since contract: runtime {runtime} · tests {tests} · docs {docs}"


def _report(root: Path, contract: Path) -> list[str]:
    text = contract.read_text(encoding="utf-8", errors="replace")
    slug = contract.stem
    for line in text.splitlines():
        if line.startswith("# "):
            slug = line[2:].strip()
            break

    count = _criteria_count(text)
    if not count:
        return []

    lines = [f"wave {slug} · {count} criteria · run ds:converge for the verdict"]

    rel = contract.relative_to(root) if contract.is_relative_to(root) else contract
    first = _git(root, "log", "--format=%H", "--reverse", "--", str(rel)).split("\n")[0]
    budget = _field(text, "budget")
    if first:
        spent = _git(root, "rev-list", "--count", f"{first}..HEAD").strip()
        wanted = re.match(r"(\d+)", budget)
        if spent and wanted:
            lines.append(f"  commits: {spent} of {wanted.group(1)}")
        elif spent:
            lines.append(f"  commits since contract: {spent}")
        mix = _layer_mix(root, first)
        if mix:
            lines.append(mix)
    return lines


def main() -> int:
    try:
        raw = sys.stdin.read()
    except (OSError, ValueError):
        return 0
    try:
        payload = json.loads(raw) if raw.strip() else {}
    except (ValueError, TypeError):
        return 0
    if not isinstance(payload, dict):
        return 0

    given = payload.get("cwd")
    if not isinstance(given, str) or not given:
        return 0
    root = Path(given)
    if not root.is_dir():
        return 0

    try:
        live = _live_slugs(root)
    except (OSError, ValueError):
        return 0

    out: list[str] = []
    for slug in live:
        contract = _contract_for(root, slug)
        if contract is None:
            out.append(
                f"wave {slug} · no contract · ds:new writes one, ds:converge reads it"
            )
            continue
        try:
            out.extend(_report(root, contract))
        except (OSError, ValueError, UnicodeError):
            continue
    if out:
        print("\n".join(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
