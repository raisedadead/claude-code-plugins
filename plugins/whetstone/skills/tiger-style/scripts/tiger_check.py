#!/usr/bin/env python3
"""Check the column budget of lines a commit ADDS, reading the staged diff.

Exit codes:
  0  clean
  1  offences against a limit the repo declared  (BLOCK)
  2  offences against the built-in 100 fallback  (NAG, advisory)
  64 usage error — the path is not a git work tree

The limit is resolved per file: WHETSTONE_TIGER_COLS, else .editorconfig
max_line_length — nearest by directory, last matching section within a file —
else 100 as a nag-only default. A declared limit blocks; the fallback never
does. A value that is neither a positive integer nor `off` is ignored, and
saying so on stderr is the point: an ignored limit the operator believes is
active is the failure this checker exists to prevent.
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

FALLBACK_COLS = 100
TAB_STOP = 8
BRACE_LIMIT = 256
MAX_CONFIG_DEPTH = 64
OFF = -1
CLEAN, BLOCK, NAG, USAGE = 0, 1, 2, 64

SKIP_SUFFIXES = frozenset(
    {
        ".md",
        ".markdown",
        ".rst",
        ".txt",
        ".json",
        ".jsonl",
        ".csv",
        ".tsv",
        ".svg",
        ".lock",
        ".snap",
    }
)
SKIP_NAMES = frozenset({"go.sum", "pnpm-lock.yaml"})

_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["git", *args], cwd=root, capture_output=True, text=True, check=False
        )
    except (FileNotFoundError, NotADirectoryError, PermissionError):
        return subprocess.CompletedProcess(list(args), 127, "", "git unavailable")


def _work_tree_top(root: Path) -> Path | None:
    """The work-tree top for a path inside a repository, or None.

    git reports diff paths relative to the top, and `_added_lines` hands them
    straight back as pathspecs. Anchored below the top the two disagree and
    every file measures zero added lines — reported as `CLEAN <n> file`, not as
    a skip, so the examined count claimed a look that never happened. The
    `.editorconfig` chain walks up to this same path, so a declared limit at
    the top reaches a file staged anywhere beneath it.
    """
    if not root.is_dir():
        return None
    probe = _run_git(root, "rev-parse", "--show-toplevel")
    if probe.returncode != 0:
        return None
    top = probe.stdout.strip()
    return Path(top) if top else None


def _staged_entries(root: Path) -> list[tuple[str, list[str]]]:
    """Return (path, paths-to-diff) for everything the index adds or changes.

    `-z` output is never quoted or octal-escaped, so a path holding a space or
    a non-ASCII character survives intact. Reading them out of `+++` headers
    does not: git quotes those, and the quoting silently broke limit lookup.

    A rename carries BOTH names, because git only pairs the two sides when the
    diff is given both. Ask for the new path alone and a moved file reports
    every one of its lines as freshly added — a file move would light up the
    whole file for lines it did not touch.
    """
    listing = _run_git(
        root, "diff", "--cached", "--name-status", "-z", "-M", "--diff-filter=ACMRT"
    )
    if listing.returncode != 0:
        return []
    tokens = [entry for entry in listing.stdout.split("\0") if entry]
    entries: list[tuple[str, list[str]]] = []
    index = 0
    while index < len(tokens) - 1:
        status = tokens[index]
        if status[:1] in ("R", "C") and index + 2 < len(tokens):
            old, new = tokens[index + 1], tokens[index + 2]
            entries.append((new, [old, new]))
            index += 3
        else:
            path = tokens[index + 1]
            entries.append((path, [path]))
            index += 2
    return entries


def _added_lines(root: Path, paths: list[str]) -> list[tuple[int, str]]:
    """Return (line-number, text) for each line the index ADDS to one file.

    Diffing a single path removes the file-header ambiguity entirely. Within
    one file's diff nothing before the first `@@` is content, and after it every
    content line carries a `+`/`-` marker — so an added line reading `++ b/x.md`
    can no longer be mistaken for a `+++ b/x.md` header and silently redirect
    the rest of the diff at another file.

    Reads `--cached`, never `HEAD`. `--cached` is HEAD-against-index, which is
    exactly what the commit will contain. `git diff HEAD` is HEAD-against-worktree:
    it drags in unstaged edits the commit will not carry, and it fails outright
    before the first commit exists, which this function would swallow as "no
    lines added".

    That failure reads `fatal: bad revision 'HEAD'` for the call below, because
    a pathspec after `--` changes the message; a bare `git diff HEAD` says
    `fatal: ambiguous argument 'HEAD'` instead. An earlier pass called the
    first string invented, checked it by running the bare form, and replaced it
    with the second — three separate reviews then confirmed the wrong one, each
    by re-running that same bare form. Probe the invocation the code makes, not
    the one the sentence resembles.
    """
    diff = _run_git(
        root,
        "diff",
        "--cached",
        "--unified=0",
        "--no-color",
        "--no-ext-diff",
        "-M",
        "--",
        *paths,
    )
    if diff.returncode != 0:
        return []
    added: list[tuple[int, str]] = []
    lineno = 0
    in_body = False
    for raw in diff.stdout.splitlines():
        hunk = _HUNK.match(raw)
        if hunk:
            lineno = int(hunk.group(1))
            in_body = True
            continue
        if in_body and raw.startswith("+"):
            added.append((lineno, raw[1:]))
            lineno += 1
    return added


def _expand_braces(pattern: str) -> list[str]:
    """Expand `{a,b}` groups, bounded at BRACE_LIMIT alternatives.

    Expansion is 2^groups. Twenty-two groups in one section header took the
    check past thirty seconds, which is a hang on every commit for whoever
    wrote that `.editorconfig`. Past the cap the pattern is left unexpanded:
    it then matches nothing, so the file falls back to the advisory limit
    rather than to a wrong declared one.
    """
    current = [pattern]
    while True:
        expanded: list[str] = []
        changed = False
        for item in current:
            match = re.search(r"\{([^{}]*)\}", item)
            if not match:
                expanded.append(item)
                continue
            changed = True
            head, tail = item[: match.start()], item[match.end() :]
            expanded.extend(
                head + choice + tail for choice in match.group(1).split(",")
            )
        if not changed:
            return current
        if len(expanded) > BRACE_LIMIT:
            return [pattern]
        current = expanded


GLOBSTAR_SLASH, GLOBSTAR, STAR, ANY, CLASS, LIT = "**/", "**", "*", "?", "[]", "c"


def _tokens(pattern: str) -> list[tuple[str, str]]:
    """Split a section header into match tokens. A bare glob matches anywhere.

    Tokens rather than a compiled regex, because the header is repo-controlled
    text and compiling it had two failure modes of its own: `[[!]]` spliced into
    a character class raised `re.error`, whose traceback exits 1 — the code this
    tool uses for BLOCK — and `*a*a...*b` against a long path backtracked for
    minutes. Matching over tokens (`_glob_matches`) is linear in the path and
    can neither raise nor stall.
    """
    out: list[tuple[str, str]] = []
    i = 0
    while i < len(pattern):
        char = pattern[i]
        if pattern.startswith("**/", i):
            out.append((GLOBSTAR_SLASH, ""))
            i += 3
        elif pattern.startswith("**", i):
            out.append((GLOBSTAR, ""))
            i += 2
        elif char == "*":
            out.append((STAR, ""))
            i += 1
        elif char == "?":
            out.append((ANY, ""))
            i += 1
        elif char == "[":
            close = pattern.find("]", i + 1)
            if close == -1:
                out.append((LIT, char))
                i += 1
            else:
                out.append((CLASS, pattern[i + 1 : close]))
                i = close + 1
        else:
            out.append((LIT, char))
            i += 1
    if "/" not in pattern:
        out.insert(0, (GLOBSTAR_SLASH, ""))
    return out


def _in_class(body: str, char: str) -> bool:
    """One character against a `[abc]` / `[a-z]` / `[!abc]` body."""
    negated = body.startswith("!")
    if negated:
        body = body[1:]
    hit = False
    i = 0
    while i < len(body):
        if i + 2 < len(body) and body[i + 1] == "-":
            hit = hit or body[i] <= char <= body[i + 2]
            i += 3
        else:
            hit = hit or body[i] == char
            i += 1
    return hit != negated


def _glob_matches(pattern: str, path: str) -> bool:
    """Whether one section glob covers one repo-relative path.

    Reachable path positions are carried forward one token at a time, so the
    cost is tokens times path length whatever the header contains. `*` and `?`
    stop at a directory boundary; `**` crosses one.
    """
    length = len(path)
    reachable = [False] * (length + 1)
    reachable[0] = True
    for kind, body in _tokens(pattern):
        nxt = [False] * (length + 1)
        if kind == STAR:
            run = False
            for j in range(length + 1):
                run = run or reachable[j]
                nxt[j] = run
                if j < length and path[j] == "/":
                    run = False
        elif kind == GLOBSTAR:
            run = False
            for j in range(length + 1):
                run = run or reachable[j]
                nxt[j] = run
        elif kind == GLOBSTAR_SLASH:
            run = False
            for j in range(length + 1):
                run = run or reachable[j]
                nxt[j] = reachable[j] or (run and j > 0 and path[j - 1] == "/")
        else:
            for j in range(length):
                if not reachable[j]:
                    continue
                char = path[j]
                if kind == LIT:
                    nxt[j + 1] = char == body
                elif kind == ANY:
                    nxt[j + 1] = char != "/"
                else:
                    nxt[j + 1] = _in_class(body, char)
        if not any(nxt):
            return False
        reachable = nxt
    return reachable[length]


def _sections(text: str) -> list[tuple[str, dict[str, str]]]:
    found: list[tuple[str, dict[str, str]]] = []
    preamble: dict[str, str] = {}
    current = preamble
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line[0] in "#;":
            continue
        if line.startswith("[") and line.endswith("]"):
            current = {}
            found.append((line[1:-1], current))
        elif "=" in line:
            key, _, value = line.partition("=")
            current[key.strip().lower()] = value.strip()
    found.insert(0, ("", preamble))
    return found


def _config_chain(root: Path, rel: str) -> list[Path]:
    """.editorconfig files from the file's directory up to the repo root.

    The walk is bounded because an unbounded one hangs rather than fails.
    Changing the exit test's `or` to `and` made this spin forever: at the
    filesystem root `current.parent == current` stays true while `current ==
    stop` never becomes true again, so every commit blocked with no output.
    A depth cap turns that class of typo into a wrong answer, which a test
    can see. MAX_CONFIG_DEPTH is far past any real tree.
    """
    chain: list[Path] = []
    current = (root / rel).parent.resolve()
    stop = root.resolve()
    for _ in range(MAX_CONFIG_DEPTH):
        candidate = current / ".editorconfig"
        if candidate.is_file():
            chain.append(candidate)
            preamble = _sections(
                candidate.read_text(encoding="utf-8", errors="replace")
            )
            if preamble[0][1].get("root", "").lower() == "true":
                break
        if current == stop or current.parent == current:
            break
        current = current.parent
    return chain


def _editorconfig_limit(root: Path, rel: str) -> int | None:
    """max_line_length for rel, OFF when declared off, None when undeclared."""
    limit: int | None = None
    for config in reversed(_config_chain(root, rel)):
        base = config.parent.resolve()
        try:
            scoped = str((root / rel).resolve().relative_to(base))
        except ValueError:
            continue
        text = config.read_text(encoding="utf-8", errors="replace")
        for glob, values in _sections(text):
            if not glob or "max_line_length" not in values:
                continue
            if not any(_glob_matches(alt, scoped) for alt in _expand_braces(glob)):
                continue
            raw = values["max_line_length"].lower()
            if raw == "off":
                limit = OFF
                continue
            parsed = _positive_int(raw)
            if parsed is None:
                print(
                    f"tiger_check: ignoring max_line_length={raw!r} in {config}"
                    " — expected a positive integer or 'off'",
                    file=sys.stderr,
                )
                continue
            limit = parsed
    return limit


def _positive_int(raw: str) -> int | None:
    """`str.isdigit()` is true for '²' while `int('²')` raises — parse, don't test."""
    try:
        value = int(raw)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _env_limit() -> int | None:
    """Parse WHETSTONE_TIGER_COLS, and say so out loud when it is unusable.

    An unusable value is dropped and resolution continues at the next source —
    `.editorconfig`, then the 100-column fallback — so the operator who typed
    `WHETSTONE_TIGER_COLS=0` gets whatever that repo declares rather than the
    limit they thought they set. Naming it on stderr is what makes the
    difference visible; silence would leave them reading someone else's number
    as their own.
    """
    raw = os.environ.get("WHETSTONE_TIGER_COLS", "").strip()
    if not raw:
        return None
    parsed = _positive_int(raw)
    if parsed is None:
        print(
            f"tiger_check: ignoring WHETSTONE_TIGER_COLS={raw!r}"
            " — expected a positive integer",
            file=sys.stderr,
        )
    return parsed


def _display_width(text: str) -> int:
    """Columns the line occupies on a terminal, not code points.

    `len()` is a different measurement wearing the same name: a tab counts one,
    and a CJK character counts one while rendering two. A line of 100 wide
    characters is 200 columns and would have read as exactly at the limit.
    """
    width = 0
    for char in text:
        if char == "\t":
            width += TAB_STOP - (width % TAB_STOP)
        elif unicodedata.combining(char):
            continue
        elif unicodedata.east_asian_width(char) in ("W", "F"):
            width += 2
        else:
            width += 1
    return width


def _skipped(rel: str) -> bool:
    """Prose and generated records, matched by suffix or by exact name.

    SKIP_NAMES holds only the two the suffix list cannot reach. `.lock` already
    covers `yarn.lock`, `poetry.lock`, `Cargo.lock`, `composer.lock` and
    `flake.lock`, so naming any of those again would be redundant. `go.sum`
    shares its suffix with nothing, and `pnpm-lock.yaml` shares `.yaml` with
    hand-written workflow files, so skipping every `.yaml` to reach it would
    stop measuring those. Left off the name list, a pnpm bump against a
    declared limit exits BLOCK on a file nobody typed.
    """
    path = Path(rel)
    return path.suffix.lower() in SKIP_SUFFIXES or path.name in SKIP_NAMES


def _offences(root: Path) -> tuple[list[str], int, int, int]:
    """Return offence lines, the DECLARED-limit count, and examined vs skipped.

    Declared and fallback offences are counted apart on purpose: a fallback
    offence is advisory and must never be swept into a BLOCK count just because
    some other file declared one.

    Skipped files are counted because `examined` alone cannot answer the
    question an operator actually asks. Zero examined means nothing was
    measured, and a docs-only commit reaches that the same way a mis-typed
    `git add` does — identically, until the skipped count separates them.
    """
    env = _env_limit()
    reported: list[str] = []
    declared_count = 0
    examined = 0
    skipped = 0
    for rel, paths in _staged_entries(root):
        if _skipped(rel):
            skipped += 1
            continue
        limit = env if env is not None else _editorconfig_limit(root, rel)
        if limit == OFF:
            skipped += 1
            continue
        examined += 1
        declared = limit is not None
        effective = limit if declared else FALLBACK_COLS
        for lineno, text in _added_lines(root, paths):
            width = _display_width(text.rstrip("\r\n"))
            if width <= effective:
                continue
            declared_count += 1 if declared else 0
            reported.append(f"{rel}:{lineno}: {width} cols (limit {effective})")
    return reported, declared_count, examined, skipped


def main(argv: list[str]) -> int:
    given = Path(argv[1] if len(argv) > 1 else ".")
    root = _work_tree_top(given)
    if root is None:
        print(f"tiger_check: not a git work tree: {given}", file=sys.stderr)
        return USAGE
    reported, declared_count, examined, skipped = _offences(root)
    for entry in reported:
        print(entry)
    if not reported:
        tail = f", {skipped} skipped" if skipped else ""
        print(f"TIGER: CLEAN {examined} file{'' if examined == 1 else 's'}{tail}")
        return CLEAN
    if declared_count:
        print(f"TIGER: BLOCK {declared_count}")
        return BLOCK
    print(f"TIGER: NAG {len(reported)}")
    return NAG


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
