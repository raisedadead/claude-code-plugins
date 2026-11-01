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
    python3 tools/census/census.py review | advisor | guards | missed
    python3 tools/census/census.py verdict-log [<path to .verdicts.jsonl>...]
    python3 tools/census/census.py rows <dossier dir>
    python3 tools/census/census.py runs
"""

from __future__ import annotations

import collections
import dataclasses
import datetime
import itertools
import json
import os
import re
import statistics
import sys
from collections.abc import Iterable
from pathlib import Path

TRANSCRIPTS = "~/.claude/projects/**/*.jsonl"

NOTIFICATION = re.compile(r"<tool-use-id>(.*?)</tool-use-id>.*?<result>(.*)", re.S)
COMMAND_NAME = re.compile(r"<command-name>([^<]+)</command-name>")
VERDICT_GRAMMAR = {
    "dossier:dossier-reviewer": re.compile(r"REVIEW: (PASS|CHANGES)"),
    "reviewer": re.compile(r"REVIEW: (PASS|CHANGES|clean|\d+ findings?)"),
    "whetstone:whetstone-doubter": re.compile(r"(DOUBT: FAILURES|NO FAILURE FOUND)"),
}
OPERATOR_PUSHBACK = re.compile(
    r"(?i)(^|\s)(no,|nope|that'?s (?:wrong|incorrect|not)"
    r"|you (?:didn'?t|did not|failed to|missed|forgot)|why did you"
    r"|i (?:asked|said)|stop\b|wrong\b|re-?read|you said|not what i"
    r"|again\?|wrist-tap)"
)
SELF_CORRECTION = re.compile(
    r"(?i)\b(sorry|apolog\w+|i was wrong|my mistake"
    r"|i mis(?:read|stated|counted|understood)|correction:"
    r"|you'?re (?:absolutely )?right|actually,? (?:no|it|the|that)"
    r"|let me (?:re-?check|re-?verify|double-?check|correct)"
    r"|on closer (?:look|inspection)|i (?:incorrectly|wrongly|mistakenly)"
    r"|that was (?:wrong|incorrect)|scratch that)\b"
)
FINDINGS = re.compile(r"(\d+) findings?")


def transcripts() -> list[str]:
    import glob

    found = glob.glob(os.path.expanduser(TRANSCRIPTS), recursive=True)
    return sorted(found, key=modified_at)


def modified_at(path: str) -> float:
    try:
        return os.path.getmtime(path)
    except OSError:
        return -1.0


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
            if isinstance(record, dict) and record.get("type") != "api-request-blob":
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
    if record.get("isCompactSummary"):
        return False
    if (record.get("origin") or {}).get("kind") == "peer" or record.get(
        "turnOrigin"
    ) == "peer":
        return False
    content = (record.get("message") or {}).get("content")
    if isinstance(content, str):
        return is_typed(content)
    if not isinstance(content, list):
        return False
    if any(
        isinstance(block, dict) and block.get("type") == "tool_result"
        for block in content
    ):
        return False
    return is_typed("\n".join(text_blocks(record)))


RELAYED = ("<teammate-message", "Another Claude session sent a message:")


def is_typed(text: str) -> bool:
    stripped = text.strip()
    if not stripped or "<task-notification>" in stripped:
        return False
    return not stripped.startswith(RELAYED)


def census_skills() -> None:
    """Skill and subagent invocation counts. Refreshes F15.

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

    def feed():
        for path in transcripts():
            for record in records(path):
                for block in tool_uses(record):
                    if block.get("name") in ("Agent", "Task"):
                        kind = (block.get("input") or {}).get("subagent_type", "?")
                        spawn[block.get("id")] = kind
                yield record, path

    notifications = first_notifications(feed())

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
            compliance[kind][f"on grammar: {verdict_label(found.group(1))}"] += 1
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
        print(runs_line(kind, failure_runs(per_session)))


def first_notifications(
    feed: Iterable[tuple[dict, str]],
) -> list[tuple[str, str, str]]:
    found: dict[str, tuple[str, str, str]] = {}
    for record, path in feed:
        for chunk in text_blocks(record):
            if "<task-notification>" not in chunk:
                continue
            match = NOTIFICATION.search(chunk)
            if match and match.group(1) not in found:
                found[match.group(1)] = (match.group(1), match.group(2), path)
    return list(found.values())


def verdict_label(value: str) -> str:
    if FINDINGS.fullmatch(value):
        return "findings>0" if is_failing(value) else "0 findings"
    return value


def is_failing(value: str) -> bool:
    findings = FINDINGS.fullmatch(value)
    if findings:
        return int(findings.group(1)) > 0
    return value in ("CHANGES", "DOUBT: FAILURES")


def failure_runs(per_session: dict[str, list[str]]) -> collections.Counter:
    runs: collections.Counter = collections.Counter()
    for values in per_session.values():
        run = 0
        for value in values:
            if is_failing(value):
                run += 1
            else:
                runs[run] += 1
                run = 0
        if run:
            runs[f"{run}+unresolved"] += 1
    return runs


def runs_line(kind: str, runs: collections.Counter) -> str:
    total = sum(v for k, v in runs.items() if isinstance(k, int))
    weighted = sum(k * v for k, v in runs.items() if isinstance(k, int))
    mean = f"  mean over resolved runs={weighted / total:.2f}" if total else ""
    return f"  {kind}: {dict(runs)}{mean}"


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
                prompt = "\n".join(text_blocks(record))
                turn["pushback"] = bool(OPERATOR_PUSHBACK.search(prompt[:1200]))
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

    print("## whole corpus")
    print_turn_table(flatten(buckets))
    print_pairwise(buckets)
    print(
        "\nF34: a whole-corpus difference between two models is period and work, "
        "not model — they rarely run the same days at the same effort. Only the "
        "pairwise cut above compares like with like, and where it disagrees with "
        "the whole-corpus table the pairwise read wins. Never quote the "
        "whole-corpus rate alone."
    )


def print_pairwise(buckets: dict, floor: int = 25) -> None:
    """Every model pair, restricted to the days both of them ran.

    The whole-corpus table compares models that mostly ran in different weeks
    on different work. This is the cut that compares like with like, and it is
    the one F34 calls load-bearing — it reversed the headline once already.
    """
    days_by_model: dict[str, set] = collections.defaultdict(set)
    for (model, day), _turns in buckets.items():
        if day:
            days_by_model[model].add(day)
    models = sorted(days_by_model, key=lambda m: -len(flatten(buckets)[m]))
    for index, left in enumerate(models):
        for right in models[index + 1 :]:
            shared = days_by_model[left] & days_by_model[right]
            if not shared:
                continue
            paired = flatten(buckets, only_days=shared)
            subset = {k: v for k, v in paired.items() if k in (left, right)}
            if any(len(v) < floor for v in subset.values()) or len(subset) < 2:
                continue
            print(f"\n## {left} vs {right} — the {len(shared)} days both ran")
            print(f"   {min(shared)} .. {max(shared)}")
            print_turn_table(subset, floor=floor)


def flatten(buckets: dict, only_days: set | None = None) -> dict[str, list]:
    by_model: dict[str, list] = collections.defaultdict(list)
    for (model, day), turns in buckets.items():
        if only_days is None or day in only_days:
            by_model[model] += turns
    return by_model


def day_overlap(buckets: dict) -> set:
    """Days on which more than one model ran, which is the only fair cut."""
    per_day: dict[str, set] = collections.defaultdict(set)
    for (model, day), _turns in buckets.items():
        if day:
            per_day[day].add(model)
    return {day for day, models in per_day.items() if len(models) > 1}


def print_turn_table(by_model: dict[str, list], floor: int = 25) -> None:
    print(
        f"{'model':20} {'turns':>6} {'msgs/turn':>10} {'chars/turn':>11} "
        f"{'corr/turn':>10} {'turns w/ corr':>14} {'pushback':>10}"
    )
    for model, turns in sorted(by_model.items(), key=lambda item: -len(item[1])):
        if len(turns) < floor:
            continue
        with_correction = sum(1 for t in turns if t["corrections"]) / len(turns) * 100
        pushback = sum(1 for t in turns if t["pushback"]) / len(turns) * 100
        print(
            f"{model:20} {len(turns):6d} "
            f"{statistics.mean([t['messages'] for t in turns]):10.1f} "
            f"{statistics.mean([t['characters'] for t in turns]):11.0f} "
            f"{statistics.mean([t['corrections'] for t in turns]):10.3f} "
            f"{with_correction:13.1f}% {pushback:9.1f}%"
        )


COMMAND_ARGS = re.compile(r"<command-args>([^<]*)</command-args>")
TRIGGER_CLAUSE = re.compile(r"(?i)invoke when[^.]*")
QUOTED = re.compile(r'"([^"]+)"')
GUARDS = {
    "marker guard": "dossier marker guard:",
    "invariant guard": "dossier invariant guard:",
    "header guard": "dossier: refusing to write non-canonical header state",
}


def tool_result_texts(record: dict) -> list[str]:
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    texts: list[str] = []
    for block in content:
        if not isinstance(block, dict) or block.get("type") != "tool_result":
            continue
        inner = block.get("content")
        if isinstance(inner, str):
            texts.append(inner)
        elif isinstance(inner, list):
            texts += [
                part.get("text") or "" for part in inner if isinstance(part, dict)
            ]
    return texts


def review_flag(records) -> dict[str, int]:
    counts = {"builds": 0, "with --review": 0}
    for record in records:
        for block in tool_uses(record):
            payload = block.get("input") or {}
            if block.get("name") == "Skill" and payload.get("skill") == "dossier:build":
                counts["builds"] += 1
                counts["with --review"] += "--review" in str(payload.get("args") or "")
        for chunk in text_blocks(record):
            names = [name.strip().lstrip("/") for name in COMMAND_NAME.findall(chunk)]
            if "dossier:build" in names:
                counts["builds"] += 1
                counts["with --review"] += any(
                    "--review" in a for a in COMMAND_ARGS.findall(chunk)
                )
    return counts


def advisor_calls(records) -> dict[str, int]:
    counts = {"main thread": 0, "subagent": 0}
    for record in records:
        content = (record.get("message") or {}).get("content")
        for block in content if isinstance(content, list) else []:
            if (
                isinstance(block, dict)
                and block.get("type") == "server_tool_use"
                and block.get("name") == "advisor"
            ):
                counts["subagent" if record.get("isSidechain") else "main thread"] += 1
    return counts


def guard_fires(records) -> dict[str, int]:
    counts: collections.Counter = collections.Counter()
    for record in records:
        for text in tool_result_texts(record):
            for guard, marker in GUARDS.items():
                counts[guard] += text.lstrip().startswith(marker)
    return {guard: count for guard, count in counts.items() if count}


def trigger_phrases(description: str) -> list[str]:
    clause = TRIGGER_CLAUSE.search(description)
    return QUOTED.findall(clause.group(0)) if clause else []


TAGGED = re.compile(r"<([a-z-]+)>.*?</\1>", re.S)


def said(phrase: str, prompt: str) -> bool:
    return (
        re.search(rf"(?<![\w:/-]){re.escape(phrase.lower())}(?![\w:-])", prompt)
        is not None
    )


def missed_calls(records, triggers: dict[str, list[str]]) -> dict[str, dict[str, int]]:
    counts: dict[str, dict[str, int]] = {}
    pending: set[str] = set()

    def settle() -> None:
        for skill in pending:
            counts[skill]["missed"] += 1
        pending.clear()

    for record in records:
        if record.get("isMeta"):
            continue
        if is_operator_prompt(record):
            settle()
            joined = "\n".join(text_blocks(record))
            typed = {name.strip().lstrip("/") for name in COMMAND_NAME.findall(joined)}
            prompt = TAGGED.sub(" ", joined).lower()
            for skill, phrases in triggers.items():
                if skill in typed or not any(
                    said(phrase, prompt) for phrase in phrases
                ):
                    continue
                counts.setdefault(skill, {"asked": 0, "missed": 0})["asked"] += 1
                pending.add(skill)
            continue
        for block in tool_uses(record):
            if block.get("name") == "Skill":
                pending.discard((block.get("input") or {}).get("skill"))
    settle()
    return counts


def verdict_log(lines) -> dict[str, dict[str, int]]:
    counts: dict[str, collections.Counter] = collections.defaultdict(
        collections.Counter
    )
    for line in lines:
        try:
            record = json.loads(line)
        except (ValueError, TypeError):
            continue
        if not isinstance(record, dict):
            continue
        kind = str(record.get("agent_type"))
        verdicts = record.get("verdicts")
        if verdicts is None:
            counts[kind]["no message"] += 1
        elif not verdicts:
            counts[kind]["no verdict line"] += 1
        for verdict in verdicts or []:
            counts[kind][verdict] += 1
    return {kind: dict(counter) for kind, counter in counts.items()}


def report(title: str, counter: collections.Counter, limit: int | None = None) -> None:
    print(f"\n## {title}  (total {sum(counter.values())})")
    for key, count in counter.most_common(limit):
        print(f"  {count:6d}  {key}")


SKILLS = Path(__file__).resolve().parents[2] / "plugins"
DESCRIPTION = re.compile(r"^description: (.*)$", re.M)


def skill_triggers() -> dict[str, list[str]]:
    triggers: dict[str, list[str]] = {}
    for path in sorted(SKILLS.glob("*/skills/*/SKILL.md")):
        found = DESCRIPTION.search(path.read_text(encoding="utf-8"))
        phrases = trigger_phrases(found.group(1)) if found else []
        if phrases:
            triggers[f"{path.parts[-4]}:{path.parts[-2]}"] = phrases
    return triggers


def per_transcript(count, merge) -> None:
    files = transcripts()
    for path in files:
        merge(count(list(records(path))))
    print(f"transcripts: {len(files)}")


def census_review() -> None:
    total: collections.Counter = collections.Counter()
    per_transcript(review_flag, total.update)
    print(
        "source: dossier:build Skill calls and typed /dossier:build commands "
        f"in {TRANSCRIPTS}; a call counts once with --review in its args"
    )
    report("dossier:build calls", total)


def census_advisor() -> None:
    total: collections.Counter = collections.Counter()
    per_transcript(advisor_calls, total.update)
    print(f"source: server_tool_use blocks named advisor in {TRANSCRIPTS}")
    report("advisor calls", total)


def census_guards() -> None:
    total: collections.Counter = collections.Counter()
    per_transcript(guard_fires, total.update)
    print(
        f"source: tool results in {TRANSCRIPTS} that start with a write-time guard "
        "denial; the fake-impl backstop fires at Stop and is not counted"
    )
    report("guard fires", total)


def census_missed() -> None:
    triggers = skill_triggers()
    total: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)

    def merge(counts: dict[str, dict[str, int]]) -> None:
        for skill, pair in counts.items():
            total[skill].update(pair)

    per_transcript(lambda found: missed_calls(found, triggers), merge)
    print(
        f"source: operator prompts in {TRANSCRIPTS} that contain a quoted trigger "
        f"phrase from a {SKILLS}/*/skills/*/SKILL.md description, and no Skill call "
        "for that skill before the next prompt. A phrase match is a heuristic."
    )
    for skill, pair in sorted(total.items(), key=lambda item: -item[1]["missed"]):
        print(f"  {pair['missed']:5d} missed of {pair['asked']:5d} asked  {skill}")


def census_verdict_log() -> None:
    paths = sys.argv[2:] or [".scratchpad/dossier/.verdicts.jsonl"]
    total: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for name in paths:
        path = Path(name)
        lines = path.read_text(encoding="utf-8").splitlines() if path.is_file() else []
        for kind, counts in verdict_log(lines).items():
            total[kind].update(counts)
    print(f"source: {', '.join(paths)}, written by the dossier SubagentStop hook")
    for kind, counter in total.items():
        report(kind, counter)


STATUS_LINE = re.compile(
    r"^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})(:\d{2})? ds:build (T\d+)\b(.*)$"
)
ROW_START = re.compile(r"\bSTART\b")
ROW_END = re.compile(r"\b(DONE|PAUSE|BLOCKED)\b")
USAGE_FIELDS = {
    "input": "input_tokens",
    "cache write": "cache_creation_input_tokens",
    "cache read": "cache_read_input_tokens",
    "output": "output_tokens",
}
UTC = datetime.timezone.utc


@dataclasses.dataclass
class RowLedger:
    windows: list = dataclasses.field(default_factory=list)
    delegated: bool = False
    open: bool = False
    started: datetime.datetime | None = None


def row_windows(
    lines: list[str], zone: datetime.tzinfo | None = None
) -> dict[str, RowLedger]:
    rows: dict[str, RowLedger] = {}
    for line in lines:
        found = STATUS_LINE.match(line.strip())
        if not found:
            continue
        minute, seconds, row, rest = found.groups()
        naive = datetime.datetime.strptime(
            minute + (seconds or ":00"), "%Y-%m-%d %H:%M:%S"
        )
        stamp = naive.replace(tzinfo=zone) if zone else naive.astimezone()
        ledger = rows.setdefault(row, RowLedger())
        if "delegate=" in rest:
            ledger.delegated = True
        if ROW_START.search(rest):
            ledger.started = stamp.astimezone(UTC)
            ledger.open = True
        elif ROW_END.search(rest) and ledger.started:
            end = stamp if seconds else stamp + datetime.timedelta(seconds=59)
            ledger.windows.append((ledger.started, end.astimezone(UTC)))
            ledger.started = None
            ledger.open = False
    return rows


def utc_stamp(text: object) -> datetime.datetime | None:
    if not isinstance(text, str):
        return None
    try:
        return datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def row_tokens(rows: dict[str, RowLedger], feed, root: str) -> dict[str, dict]:
    spans = sorted(
        (start, end, row)
        for row, ledger in rows.items()
        for start, end in ledger.windows
    )
    tally: dict[str, dict] = {}
    seen: set[str] = set()
    for record, agent in feed:
        message = record.get("message") or {}
        usage = message.get("usage")
        key = message.get("id")
        cwd = record.get("cwd") or ""
        if record.get("type") != "assistant" or not isinstance(usage, dict):
            continue
        if (key and key in seen) or (cwd != root and not cwd.startswith(root + "/")):
            continue
        stamp = utc_stamp(record.get("timestamp"))
        owners = [row for start, end, row in spans if stamp and start <= stamp <= end]
        if not owners:
            continue
        if key:
            seen.add(key)
        side = agent or ("subagent" if record.get("isSidechain") else "main")
        bucket = tally.setdefault(owners[-1], {"sessions": set(), "models": set()})
        counts = bucket.setdefault(side, collections.Counter())
        for label, field in USAGE_FIELDS.items():
            counts[label] += int(usage.get(field) or 0)
        if record.get("sessionId"):
            bucket["sessions"].add(record["sessionId"])
        bucket["models"].add(f"{side}={message.get('model')}")
    return tally


def row_exclusion(ledger: RowLedger, bucket: dict) -> str | None:
    if ledger.open:
        return "OPEN: started and not closed, not in the medians"
    if len(bucket.get("sessions", ())) > 1:
        return "SHARED: more than one session in the window, not in the medians"
    if not sum((bucket.get("main") or {}).values()):
        return "NO TRANSCRIPT: no main-thread message matched, not in the medians"
    return None


def class_median(values: list[int]) -> str:
    if len(values) < 3:
        return f"UNVERIFIED: fewer than 3 rows (n={len(values)})"
    return f"median {round(statistics.median(values))} (n={len(values)})"


def agent_type_of(path: str) -> str | None:
    meta = Path(path).with_suffix(".meta.json")
    if not meta.is_file():
        return None
    try:
        return json.loads(meta.read_text(encoding="utf-8")).get("agentType")
    except (OSError, ValueError):
        return None


def census_rows() -> None:
    if len(sys.argv) < 3:
        print("usage: census.py rows <dossier dir>", file=sys.stderr)
        raise SystemExit(64)
    wave = Path(sys.argv[2]).resolve()
    root = next((p.parent for p in wave.parents if p.name == ".scratchpad"), None)
    ledger = wave / "DOSSIER.md"
    if root is None or not ledger.is_file():
        print(
            f"census.py rows: no DOSSIER.md under a .scratchpad: {wave}",
            file=sys.stderr,
        )
        raise SystemExit(64)
    rows = row_windows(ledger.read_text(encoding="utf-8").splitlines())
    prefix = str(root).replace("/", "-").replace(".", "-")
    feed = (
        (record, agent_type_of(path))
        for path in transcripts()
        if Path(path)
        .relative_to(Path(os.path.expanduser("~/.claude/projects")))
        .parts[0]
        .startswith(prefix)
        for record in records(path)
    )
    tally = row_tokens(rows, feed, str(root))
    print(
        f"source: {ledger} status lines, read in the local zone at each stamp, "
        f"joined to message usage in {TRANSCRIPTS} with cwd under {root}"
    )
    by_class: dict[str, list[int]] = collections.defaultdict(list)
    for row in sorted(rows, key=lambda name: int(name[1:])):
        kind = "delegated" if rows[row].delegated else "inline"
        bucket = tally.get(row, {})
        if not rows[row].windows:
            print(f"{row} {kind} open")
            continue
        sides = {k: v for k, v in bucket.items() if k not in ("sessions", "models")}
        main_counts = bucket.get("main") or collections.Counter()
        main = sum(main_counts.values())
        split = " ".join(f"{label}={main_counts[label]}" for label in USAGE_FIELDS)
        detail = ", ".join(
            f"{side} {sum(c.values())}" for side, c in sorted(sides.items())
        )
        excluded = row_exclusion(rows[row], bucket)
        flag = f" {excluded}" if excluded else ""
        models = sorted(bucket.get("models", ()))
        print(f"{row} {kind} main={main} ({split}) [{detail}] models={models}{flag}")
        if not excluded:
            by_class[kind].append(main)
    fields = " + ".join(USAGE_FIELDS)
    for kind in ("delegated", "inline"):
        median = class_median(by_class[kind])
        print(f"{kind}: main-thread tokens per row ({fields}), {median}")


SCRIPTABLE = {"Bash", "Read", "Grep", "Glob", "Edit", "Write", "WebFetch"}


@dataclasses.dataclass
class Turn:
    tools: list
    sidechain: bool
    cache_read: int


def is_notification(record: dict) -> bool:
    return record.get("type") == "user" and any(
        "<task-notification>" in chunk for chunk in text_blocks(record)
    )


def calls_in(record: dict) -> list[str]:
    content = (record.get("message") or {}).get("content")
    if not isinstance(content, list):
        return []
    return [
        block.get("name") or "?"
        for block in content
        if isinstance(block, dict)
        and block.get("type") in ("tool_use", "server_tool_use")
    ]


def turn_sequence(stream, elsewhere: set[str] | None = None) -> list:
    elsewhere = set() if elsewhere is None else elsewhere
    sequence: list = []
    turns: dict[str, Turn | None] = {}
    for record in stream:
        if (
            is_operator_prompt(record)
            or is_notification(record)
            or record.get("isCompactSummary")
        ):
            sequence.append(None)
            continue
        message = record.get("message") or {}
        key = message.get("id")
        if record.get("type") != "assistant" or not key:
            continue
        if key not in turns:
            usage = message.get("usage") or {}
            cache_read = int(usage.get("cache_read_input_tokens") or 0)
            fresh = key not in elsewhere
            turns[key] = (
                Turn([], bool(record.get("isSidechain")), cache_read) if fresh else None
            )
            sequence.append(turns[key])
        if turns[key] is not None:
            turns[key].tools.extend(calls_in(record))
    elsewhere.update(turns)
    return sequence


def call_runs(sequence: list, minimum: int = 3) -> list[list[Turn]]:
    runs: list[list[Turn]] = []
    current: list[Turn] = []
    for turn in [*sequence, None]:
        single = turn is not None and len(turn.tools) == 1
        if single and turn.tools[0] in SCRIPTABLE:
            current.append(turn)
            continue
        if len(current) >= minimum:
            runs.append(current)
        current = []
    return runs


def collapse(names: list[str]) -> str:
    groups = [(name, len(list(run))) for name, run in itertools.groupby(names)]
    return ", ".join(name if n == 1 else f"{name} x{n}" for name, n in groups)


def census_runs() -> None:
    files = transcripts()
    counted: set[str] = set()
    calls: collections.Counter = collections.Counter()
    inside: collections.Counter = collections.Counter()
    reread: collections.Counter = collections.Counter()
    buckets = collections.defaultdict(collections.Counter)
    shapes = collections.defaultdict(collections.Counter)
    for path in files:
        sequence = turn_sequence(records(path), counted)
        for side in (False, True):
            turns = [t for t in sequence if t is None or t.sidechain is side]
            name = "subagent" if side else "main thread"
            calls[name] += sum(len(t.tools) for t in turns if t)
            for run in call_runs(turns):
                size = len(run)
                inside[name] += size
                reread[name] += sum(t.cache_read for t in run[1:])
                bucket = "3-4" if size < 5 else "5-9" if size < 10 else "10+"
                buckets[name][bucket] += 1
                shapes[name][collapse([t.tools[0] for t in run])] += 1
    print(
        f"source: assistant tool_use and server_tool_use blocks per message id "
        f"in {len(files)} transcripts under {TRANSCRIPTS}, least recently "
        f"written file first; a run is 3+ consecutive single-call turns of "
        f"{sorted(SCRIPTABLE)}, broken by an operator prompt, a task "
        f"notification, a multi-call or other-tool turn, or a turn an older "
        f"file already holds"
    )
    print(
        "UPPER BOUND, computed: whether the model had to read a result before "
        "the next call is model-judgment and not counted. The cache-read figure "
        "is what the 2nd..nth turns were billed, not a computed saving."
    )
    for name in ("main thread", "subagent"):
        print(
            f"\n## {name}: {inside[name]} of {calls[name]} tool calls sit in runs; "
            f"runs {dict(buckets[name])}; cache read by the 2nd..nth turns "
            f"{reread[name]}"
        )
        for shape, count in shapes[name].most_common(5):
            print(f"  {count:6d}  {shape}")


MODES = {
    "skills": census_skills,
    "verdicts": census_verdicts,
    "turns": census_turns,
    "review": census_review,
    "advisor": census_advisor,
    "guards": census_guards,
    "missed": census_missed,
    "verdict-log": census_verdict_log,
    "rows": census_rows,
    "runs": census_runs,
}


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else ""
    if mode not in MODES:
        print(f"usage: census.py {{{' | '.join(MODES)}}}", file=sys.stderr)
        return 64
    MODES[mode]()
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
