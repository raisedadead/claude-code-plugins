#!/usr/bin/env bash
# Smoke test for marker_guard.py. Exits 0 on `ok`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
GUARD="$SCRIPT_DIR/marker_guard.py"
TMP="$(mktemp -d "${TMPDIR:-/tmp}/dossier-marker-guard.XXXXXX")"

cleanup() {
	rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
	printf 'FAIL: %s\n' "$1" >&2
	exit 1
}

run_edit() {
	local path="$1" content="$2"
	python3 -c '
import json, sys
print(json.dumps({
    "tool_name": "Edit",
    "tool_input": {"file_path": sys.argv[1], "new_string": sys.argv[2]},
}))
' "$path" "$content" |
		CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" 2>"$TMP/stderr"
}

run_write() {
	local path="$1" content="$2"
	python3 -c '
import json, sys
print(json.dumps({
    "tool_name": "Write",
    "tool_input": {"file_path": sys.argv[1], "content": sys.argv[2]},
}))
' "$path" "$content" |
		CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" 2>"$TMP/stderr"
}

cd "$TMP"

# 1. Real-world leak: V11 (Phase 3 / A7) in a test file.
LEAK='// V11 (Phase 3 / A7): client:idle SSRs the banner, then unmounts'
if run_edit "src/foo.test.ts" "$LEAK"; then
	fail "leak pattern 'V11 (Phase 3 / A7)' should block"
fi
grep -q "marker guard" "$TMP/stderr" || fail "block message missing for leak pattern"

# 2. Bare `// Phase 1:` blocks.
if run_edit "src/foo.ts" "// Phase 1: validate input"; then
	fail "'Phase 1:' comment should block"
fi

# 3. Bare `// Step 2:` blocks.
if run_edit "src/foo.ts" "// Step 2: emit"; then
	fail "'Step 2:' comment should block"
fi

# 4. Bare `// Stage 3:` blocks.
if run_edit "src/foo.ts" "// Stage 3"; then
	fail "'Stage 3' comment should block"
fi

# 5. Audit-id form `// PH3-B7` blocks.
if run_edit "src/foo.ts" "// PH3-B7: known-bug guard"; then
	fail "'PH3-B7' comment should block"
fi

# 6. Python `# Phase 1` blocks.
if run_edit "src/foo.py" "# Phase 1: load config"; then
	fail "python '# Phase 1' should block"
fi

# 7. Block-comment `* Phase 2` blocks.
if run_edit "src/foo.ts" "/**
 * Phase 2: hydrate
 */"; then
	fail "block-comment '* Phase 2' should block"
fi

# 8. Clean why-comment passes through.
run_edit "src/foo.ts" "// workaround for upstream bug #1234" ||
	fail "clean why-comment should allow"

# 9. Phase token inside a string literal allows (not in a comment).
run_edit "src/foo.ts" 'const labels = { phase1: "Phase 1: setup" };' ||
	fail "phase token inside string literal should allow"

# 10. Edits to dossier ledgers allow even when content carries markers.
run_write ".scratchpad/dossier/PLAN.md" "## Phase 3
- task A
" || fail "PLAN.md may carry phase markers"

run_write ".scratchpad/dossier/AUDIT.md" "PH3-B7 fixed" ||
	fail "AUDIT.md may carry audit ids"

run_write ".scratchpad/dossier/2026-01-01-foo/DOSSIER.md" "## §B
| B1 | bug | PH3-B7 | open | — |
" || fail "DOSSIER.md may carry audit ids"

# 11. Bypass env disables guard.
DOSSIER_MARKER_GUARD=off run_edit "src/foo.ts" "// Phase 1: bypass test" ||
	fail "DOSSIER_MARKER_GUARD=off should allow"

# 12. MultiEdit payload with one bad chunk blocks.
python3 -c '
import json
print(json.dumps({
    "tool_name": "MultiEdit",
    "tool_input": {
        "file_path": "src/foo.ts",
        "edits": [
            {"old_string": "a", "new_string": "// safe rename"},
            {"old_string": "b", "new_string": "// Phase 4: extract"},
        ],
    },
}))
' | CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" 2>"$TMP/stderr" &&
	fail "MultiEdit with phase marker should block"

# 13. MultiEdit with all clean chunks allows.
python3 -c '
import json
print(json.dumps({
    "tool_name": "MultiEdit",
    "tool_input": {
        "file_path": "src/foo.ts",
        "edits": [
            {"old_string": "a", "new_string": "const x = 1;"},
            {"old_string": "b", "new_string": "// workaround #1"},
        ],
    },
}))
' | CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" ||
	fail "MultiEdit with clean chunks should allow"

# 14. Non-Edit tool (e.g. Bash) is ignored.
printf '{"tool_name":"Bash","tool_input":{"command":"echo Phase 1"}}\n' |
	CLAUDE_PROJECT_DIR="$TMP" python3 "$GUARD" ||
	fail "non-Edit tool should be ignored"

printf 'ok\n'
