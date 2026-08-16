#!/usr/bin/env python3
"""Census over Claude Code session transcripts.

Produces the numbers F32, F33 and F34 record. Read those rows before trusting a
count printed here: a recorded number decays, and this script is how it is
re-derived rather than re-cited.

Two traps this script exists to avoid, both of which return a plausible wrong
answer (F32):

1. Verdict strings such as `REVIEW: PASS` are literal text inside our own
   `SKILL.md` and `ARCHITECTURE.md`. Every read of those files enters a
   transcript, so a naive text scan counts documentation as verdicts.
2. Subagents run asynchronously. The `Agent` tool result is launch metadata
   (`Async agent launched successfully`), never the verdict. The real return
   value arrives later inside a `<task-notification>` in a `user` record,
   keyed by `<tool-use-id>`.

Usage:
    python3 tools/census/census.py skills
    python3 tools/census/census.py verdicts
    python3 tools/census/census.py turns
"""

from __future__ import annotations

import collections
import json
import os
import re
import statistics
import sys

TRANSCRIPTS = "~/.claude/projects/**/*.jsonl"

NOTIFICATION = re.compile(r"<tool-use-id>(.*?)</tool-use-id>.*?<result>(.*)", re.S)
COMMAND_NAME = re.compile(r"<command-name>([^<]+)</command-name>")
VERDICT_GRAMMAR = {
    "dossier:dossier-reviewer": re.compile(r"REVIEW: (PASS|CHANGES)"),
    "reviewer": re.compile(r"REVIEW: (PASS|CHANGES)"),
    "whetstone:whetstone-doubter": re.compile(r"(DOUBT: FAILURES|NO FAILURE FOUND)"),
}
SELF_CORRECTION = re.compile(
    r"(?i)\b(sorry|apolog\w+|i was wrong|my mistake"
    r"|i mis(?:read|stated|counted|understood)|correction:"
    r"|you'?re (?:absolutely )?right|actually,? (?:no|it|the|that)"
    r"|let me (?:re-?check|re-?verify|double-?check|correct)"
    r"|on closer (?:look|inspection)|i (?:incorrectly|wrongly|mistakenly)"
    r"|that was (?:wrong|incorrect)|scratch that)\b"
)


def transcripts() -> list[str]:
    import glob

    return glob.glob(os.path.expanduser(TRANSCRIPTS), recursive=True)


def records(path: str):
    """Every parseable JSON object in one transcript, in order."""
    try:
        handle = open(path, encoding="utf-8", errors="replace")
    except OSError:
        return
    with handle:
        for line in handle:
            try:
                record = json.loads(line)
            except (ValueError, TypeError):
                continue
            if isinstance(record, dict):
                yield record


def text_blocks(record: dict) -> list[str]:
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return [content]
    if not isinstance(content, list):
        return []
    return [
        block.get("text") or ""
        for block in content
        if isinstance(block, dict) and block.get("type") == "text"
    ]


def tool_uses(record: dict):
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return
    for block in content:
        if isinstance(block, dict) and block.get("type") == "tool_use":
            yield block


def is_operator_prompt(record: dict) -> bool:
    """A real prompt, not a tool result and not a task notification."""
    if record.get("type") != "user" or record.get("isSidechain"):
        return False
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return bool(content.strip()) and "<task-notification>" not in content
    if not isinstance(content, list):
        return False
    if any(
        isinstance(block, dict) and block.get("type") == "tool_result"
        for block in content
    ):
        return False
    joined = "\n".join(text_blocks(record))
    return bool(joined.strip()) and "<task-notification>" not in joined


def census_skills() -> None:
    """Skill and subagent invocation counts. Refreshes F15, feeds O31.

    A skill reaches a transcript two ways and both are counted: the `Skill`
    tool call, and an operator-typed slash command, which lands as a
    `<command-name>` block in a user record rather than as a tool call.
    """
    skills: collections.Counter = collections.Counter()
    typed: collections.Counter = collections.Counter()
    agents: collections.Counter = collections.Counter()
    files = transcripts()
    for path in files:
        for record in records(path):
            for block in tool_uses(record):
                payload = block.get("input") or {}
                if block.get("name") == "Skill":
                    skills[payload.get("skill", "?")] += 1
                elif block.get("name") in ("Agent", "Task"):
                    agents[payload.get("subagent_type", "?")] += 1
            for chunk in text_blocks(record):
                for name in COMMAND_NAME.findall(chunk):
                    typed[name.strip()] += 1
    print(f"transcripts: {len(files)}")
    report("Skill tool calls", skills, 40)
    report("operator-typed slash commands", typed, 40)
    report("subagent spawns", agents, 25)


def census_verdicts() -> None:
    """Verdict-grammar compliance and cycles, joined through notifications.

    This is the join F32 names. Reading a verdict anywhere else is the trap.
    """
    spawn: dict[str, str] = {}
    notifications: list[tuple[str, str, str]] = []
    for path in transcripts():
        for record in records(path):
            for block in tool_uses(record):
                if block.get("name") in ("Agent", "Task"):
                    kind = (block.get("input") or {}).get("subagent_type", "?")
                    spawn[block.get("id")] = kind
            for chunk in text_blocks(record):
                if "<task-notification>" not in chunk:
                    continue
                found = NOTIFICATION.search(chunk)
                if found:
                    notifications.append((found.group(1), found.group(2), path))

    compliance: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    sequences: dict[str, dict[str, list]] = collections.defaultdict(
        lambda: collections.defaultdict(list)
    )
    corpus_wide: collections.Counter = collections.Counter()
    for tool_use_id, result, path in notifications:
        for token in ("NO FAILURE FOUND", "DOUBT: FAILURES"):
            if token in result:
                corpus_wide[token] += 1
        kind = spawn.get(tool_use_id, "<unmatched>")
        grammar = VERDICT_GRAMMAR.get(kind)
        if grammar is None:
            compliance[kind]["no verdict grammar defined"] += 1
            continue
        found = grammar.search(result)
        if found:
            compliance[kind][f"on grammar: {found.group(1)}"] += 1
            sequences[kind][path].append(found.group(1))
        else:
            compliance[kind]["NO VERDICT LINE"] += 1

    print(f"notifications: {len(notifications)}  spawns indexed: {len(spawn)}")
    print("\n## corpus-wide string search, no join (the F33 second population)")
    for token, count in corpus_wide.most_common():
        print(f"  {count:5d}  {token}")
    for kind in sorted(compliance, key=lambda k: -sum(compliance[k].values())):
        report(kind, compliance[kind])
    print("\n## failing verdicts paid before each success, per session")
    for kind, per_session in sequences.items():
        runs: collections.Counter = collections.Counter()
        for values in per_session.values():
            run = 0
            for value in values:
                if value in ("CHANGES", "DOUBT: FAILURES"):
                    run += 1
                else:
                    runs[run] += 1
                    run = 0
            if run:
                runs[f"{run}+unresolved"] += 1
        total = sum(v for k, v in runs.items() if isinstance(k, int))
        weighted = sum(k * v for k, v in runs.items() if isinstance(k, int))
        mean = f"  mean={weighted / total:.2f}" if total else ""
        print(f"  {kind}: {dict(runs)}{mean}")


def census_turns() -> None:
    """Main-thread volume and self-correction per model. Feeds F34.

    Subagents are excluded. A turn starts at a real operator prompt and ends at
    the next one; everything the main loop does in between belongs to it.
    """
    buckets: dict[tuple, list] = collections.defaultdict(list)
    for path in transcripts():
        turn = None
        for record in records(path):
            if is_operator_prompt(record):
                if turn and turn["key"]:
                    buckets[turn["key"]].append(turn)
                turn = {"key": None, "messages": 0, "characters": 0, "corrections": 0}
                turn["pushback"] = bool(
                    SELF_CORRECTION.search("\n".join(text_blocks(record)))
                )
                continue
            if turn is None:
                continue
            if record.get("type") != "assistant" or record.get("isSidechain"):
                continue
            model = (record.get("message") or {}).get("model")
            if isinstance(model, str) and model.startswith("claude-"):
                turn["key"] = (model, (record.get("timestamp") or "")[:10])
            turn["messages"] += 1
            for chunk in text_blocks(record):
                turn["characters"] += len(chunk)
                turn["corrections"] += len(SELF_CORRECTION.findall(chunk))
        if turn and turn["key"]:
            buckets[turn["key"]].append(turn)

    by_model: dict[str, list] = collections.defaultdict(list)
    for (model, _day), turns in buckets.items():
        by_model[model] += turns
    header = (
        f"{'model':20} {'turns':>6} {'msgs/turn':>10} "
        f"{'chars/turn':>11} {'corr/turn':>10} {'turns w/ corr':>14}"
    )
    print(header)
    for model, turns in sorted(by_model.items(), key=lambda item: -len(item[1])):
        if len(turns) < 25:
            continue
        with_correction = sum(1 for t in turns if t["corrections"]) / len(turns) * 100
        print(
            f"{model:20} {len(turns):6d} "
            f"{statistics.mean([t['messages'] for t in turns]):10.1f} "
            f"{statistics.mean([t['characters'] for t in turns]):11.0f} "
            f"{statistics.mean([t['corrections'] for t in turns]):10.3f} "
            f"{with_correction:13.1f}%"
        )
    print(
        "\nF34: two models rarely overlap in time or effort setting here, so a "
        "difference between rows is not attributable to the model. Cut by day "
        "before drawing one."
    )


def report(title: str, counter: collections.Counter, limit: int | None = None) -> None:
    print(f"\n## {title}  (total {sum(counter.values())})")
    for key, count in counter.most_common(limit):
        print(f"  {count:6d}  {key}")


MODES = {"skills": census_skills, "verdicts": census_verdicts, "turns": census_turns}


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode not in MODES:
        print(f"usage: census.py {{{' | '.join(MODES)}}}", file=sys.stderr)
        return 64
    MODES[mode]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
