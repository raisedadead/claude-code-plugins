"""Roll-session shared primitives.

Parses Claude Code transcript JSONL to reconstruct the live CC TaskList state,
and writes/reads compact `.tlr` (TaskList-Roll) pipe-table files.

Stdlib-only. Python 3.10+.

`.tlr` v1 format:

    # tlr v1
    sid: <session-id>
    doss: <live-dossier-slug or —>
    ts: <ISO-timestamp>
    trig: explicit | precompact | sessionend

    | i | st | subject | desc | actv | dep |
    |---|----|---------|------|------|-----|
    | 1 | x | Fix sort | INDEX regen sort flag wrong | Fixing sort | — |

State legend (matches dossier §T):
    .  pending
    ~  in_progress
    x  completed

`—` cell = absent / default (restore: desc/actv default to subject).
`dep` = comma-sep `i` of blocking tasks (none = `—`).
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

_STATUS_TO_GLYPH = {
    "pending": ".",
    "in_progress": "~",
    "completed": "x",
}
_GLYPH_TO_STATUS = {v: k for k, v in _STATUS_TO_GLYPH.items()}
_TC_RESULT_RE = re.compile(r"Task\s+#(\d+)\s+created successfully")


def _escape_cell(s: str) -> str:
    """Pipe + newline are table-breaking. Replace with safe substitutes."""
    if not s:
        return "—"
    return s.replace("|", "¦").replace("\n", " ").strip() or "—"


def _unescape_cell(s: str) -> str:
    s = s.strip()
    if s == "—":
        return ""
    return s.replace("¦", "|")


def parse_transcript(path: Path) -> tuple[list[dict], str]:
    """Walk transcript JSONL, reconstruct current TaskList state.

    Returns (tasks_in_order, session_id). tasks_in_order preserves creation order;
    deleted tasks are dropped. Each task dict has keys: id, subject, description,
    activeForm, status, owner, blockedBy (list of ids), blocks (list of ids).
    """
    sid = ""
    create_inputs: dict[str, dict] = {}  # tool_use_id → input
    create_results: dict[str, str] = {}  # tool_use_id → result text
    update_seq: list[dict] = []  # ordered list of TaskUpdate inputs

    if not path.is_file():
        return [], sid

    with path.open(errors="replace") as fh:
        for line in fh:
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not sid:
                sid = event.get("sessionId") or event.get("session_id") or sid
            msg = event.get("message") or {}
            content = msg.get("content") or []
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict):
                    continue
                btype = block.get("type")
                if btype == "tool_use":
                    name = block.get("name", "")
                    tuid = block.get("id", "")
                    inp = block.get("input") or {}
                    if name == "TaskCreate" and tuid:
                        create_inputs[tuid] = inp
                    elif name == "TaskUpdate":
                        update_seq.append(inp)
                elif btype == "tool_result":
                    tuid = block.get("tool_use_id", "")
                    if not tuid or tuid not in create_inputs:
                        continue
                    rc = block.get("content")
                    text = ""
                    if isinstance(rc, str):
                        text = rc
                    elif isinstance(rc, list):
                        for c in rc:
                            if isinstance(c, dict) and c.get("type") == "text":
                                text += c.get("text", "")
                    if text:
                        create_results[tuid] = text

    # Build state in creation order.
    tasks: dict[str, dict] = {}
    order: list[str] = []
    for tuid, inp in create_inputs.items():
        m = _TC_RESULT_RE.search(create_results.get(tuid, ""))
        if not m:
            continue  # creation didn't complete; skip
        tid = m.group(1)
        tasks[tid] = {
            "id": tid,
            "subject": inp.get("subject", ""),
            "description": inp.get("description", ""),
            "activeForm": inp.get("activeForm", ""),
            "status": "pending",
            "owner": "",
            "blockedBy": [],
            "blocks": [],
        }
        order.append(tid)

    # Apply updates in order.
    for upd in update_seq:
        tid = str(upd.get("taskId", ""))
        if not tid or tid not in tasks:
            continue
        status = upd.get("status")
        if status == "deleted":
            tasks.pop(tid, None)
            if tid in order:
                order.remove(tid)
            continue
        for k in ("subject", "description", "activeForm", "owner"):
            if k in upd:
                tasks[tid][k] = upd[k]
        if status in _STATUS_TO_GLYPH:
            tasks[tid]["status"] = status
        for k_in, k_out in (("addBlockedBy", "blockedBy"), ("addBlocks", "blocks")):
            extra = upd.get(k_in) or []
            if extra:
                tasks[tid][k_out] = sorted({*tasks[tid][k_out], *map(str, extra)})

    return [tasks[t] for t in order if t in tasks], sid


def render_tlr(tasks: list[dict], sid: str, trig: str, doss: str = "") -> str:
    """Render task list as compact `.tlr` pipe-table v1.

    Tasks list elements must have keys: id, subject, description, activeForm,
    status, blockedBy. `doss` is the live dossier slug at dump time so restore
    can warn on a cross-dossier mismatch; omitted renders `—`.
    """
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    lines = [
        "# tlr v1",
        f"sid: {sid or '?'}",
        f"doss: {doss or '—'}",
        f"ts: {ts}",
        f"trig: {trig}",
        "",
        "| i | st | subject | desc | actv | dep |",
        "|---|----|---------|------|------|-----|",
    ]
    for t in tasks:
        i = t.get("id", "?")
        st = _STATUS_TO_GLYPH.get(t.get("status", "pending"), ".")
        sub = _escape_cell(t.get("subject", ""))
        desc_raw = t.get("description", "") or ""
        desc = "—" if desc_raw == t.get("subject", "") else _escape_cell(desc_raw)
        actv_raw = t.get("activeForm", "") or ""
        actv = "—" if actv_raw == t.get("subject", "") else _escape_cell(actv_raw)
        dep_ids = t.get("blockedBy") or []
        dep = ",".join(map(str, dep_ids)) if dep_ids else "—"
        lines.append(f"| {i} | {st} | {sub} | {desc} | {actv} | {dep} |")
    return "\n".join(lines) + "\n"


def parse_tlr(text: str) -> list[dict]:
    """Parse a `.tlr` v1 file body into list of task dicts.

    Unknown trailing columns ignored (forward-compat).
    """
    out: list[dict] = []
    in_rows = False
    for raw in text.splitlines():
        line = raw.strip()
        if not line.startswith("|"):
            in_rows = False
            continue
        if set(line.replace(" ", "")) <= {"|", "-", ":"}:
            continue  # separator row
        if not in_rows:
            # First pipe-line is header. Skip then enter data rows.
            in_rows = True
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) < 3:
            continue
        i = cells[0]
        st = _GLYPH_TO_STATUS.get(cells[1], "pending")
        sub = _unescape_cell(cells[2])
        desc = _unescape_cell(cells[3]) if len(cells) > 3 else ""
        actv = _unescape_cell(cells[4]) if len(cells) > 4 else ""
        dep_raw = cells[5] if len(cells) > 5 else "—"
        dep = [d.strip() for d in dep_raw.split(",") if d.strip() and d.strip() != "—"]
        out.append(
            {
                "id": i,
                "subject": sub,
                "description": desc or sub,
                "activeForm": actv or sub,
                "status": st,
                "blockedBy": dep,
            }
        )
    return out


def parse_tlr_header(text: str) -> dict[str, str]:
    """Extract sid/doss/ts/trig from a `.tlr` header block (lines before the table)."""
    hdr: dict[str, str] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if line.startswith("|"):
            break
        if line.startswith("#") or ":" not in line:
            continue
        k, _, v = line.partition(":")
        hdr[k.strip()] = v.strip()
    return hdr


def live_slug_from_index(cwd: Path | None = None) -> str:
    """First `live` dossier's `<date>-<slug>` from INDEX.md, or '' if none."""
    index = (cwd or Path.cwd()) / ".scratchpad" / "INDEX.md"
    if not index.is_file():
        return ""
    try:
        rows = index.read_text(errors="replace").splitlines()
    except OSError:
        return ""
    for line in rows[2:]:
        if not line.startswith("|"):
            continue
        cells = [c.strip() for c in line.strip("|").split("|")]
        if len(cells) >= 3 and cells[2] == "live":
            return f"{cells[0]}-{cells[1]}"
    return ""


def roll_dir(cwd: Path | None = None) -> Path:
    """Per-project roll storage. `<cwd>/.scratchpad/.tasklist-roll/`."""
    root = (cwd or Path.cwd()) / ".scratchpad" / ".tasklist-roll"
    root.mkdir(parents=True, exist_ok=True)
    return root


def new_roll_path(cwd: Path | None = None) -> Path:
    ts = time.strftime("%Y-%m-%d_%H%M%S", time.gmtime())
    return roll_dir(cwd) / f"{ts}.tlr"
