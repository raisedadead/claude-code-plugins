#!/usr/bin/env bash
set -euo pipefail

if ((BASH_VERSINFO[0] < 5)); then
	printf 'BASH: tools/ci.sh needs bash 5 or later; this is %s\n' "$BASH_VERSION" >&2
	exit 1
fi
cd "$(git rev-parse --show-toplevel)"
job="${1:-all}"
case "$job" in dossier | tools | whetstone | all) ;; *)
	printf 'usage: tools/ci.sh <dossier|tools|whetstone|all>; CI_STEPS="<step> ..." runs only those steps\n' >&2
	exit 64
	;;
esac

pin() {
	local found
	found="$(sed -nE "$2" "$1" | sort -u)"
	if [[ ! $found =~ ^v?[0-9]+(\.[0-9]+)*$ ]]; then
		printf 'PIN: no single %s pin found in %s\n' "$3" "$1" >&2
		exit 1
	fi
	printf '%s' "$found"
}

WORKFLOW=.github/workflows/ci.yml
NODE_PIN="$(pin "$WORKFLOW" "s/^ *node-version: '([0-9.]+)'$/\1/p" node)"
SHELLCHECK_PIN="$(pin "$WORKFLOW" "s/^ *SHELLCHECK_VERSION: '(v[0-9.]+)'$/\1/p" shellcheck)"

if [[ ${CI:-} == true ]]; then
	py=(python3)
	claude=(claude)
	ruff=(ruff)
else
	if [[ "$(node --version 2>/dev/null)" != "v$NODE_PIN" ]]; then
		if ! command -v fnm >/dev/null || ! fnm exec --using "$NODE_PIN" -- node --version >/dev/null 2>&1; then
			printf 'NODE: CI runs node %s; install fnm, then run: fnm install %s\n' "$NODE_PIN" "$NODE_PIN" >&2
			exit 1
		fi
		exec fnm exec --using "$NODE_PIN" -- bash tools/ci.sh "$@"
	fi
	if ! command -v uv >/dev/null; then
		printf 'PYTHON: install uv; the local run uses it for the Python and ruff that CI runs\n' >&2
		exit 1
	fi
	PYTHON_PIN="$(pin "$WORKFLOW" "s/^ *python-version: '([0-9.]+)'$/\1/p" python)"
	CLAUDE_PIN="$(pin "$WORKFLOW" 's/.*@anthropic-ai\/claude-code@([0-9.]+).*/\1/p' claude-code)"
	RUFF_PIN="$(pin requirements-dev.txt 's/^ruff==([0-9.]+)$/\1/p' ruff)"
	py=(uv run -q --no-project --python "$PYTHON_PIN" python)
	claude=(npx -y "@anthropic-ai/claude-code@$CLAUDE_PIN")
	ruff=(uvx "ruff@$RUFF_PIN")
fi

JOBS="${CI_JOBS:-$(getconf _NPROCESSORS_ONLN)}"
if [[ ! $JOBS =~ ^[1-9][0-9]*$ ]]; then
	printf 'CI_JOBS must be a positive number, not %s\n' "$JOBS" >&2
	exit 64
fi

set -m
LOGS="$(mktemp -d "${TMPDIR:-/tmp}/ci.XXXXXX")"
stop() {
	local pid
	for pid in $(jobs -p); do kill -TERM -- "-$pid" 2>/dev/null || true; done
	rm -rf "$LOGS"
}
trap stop EXIT
trap 'report; exit 130' INT
trap 'report; exit 143' TERM
started=$EPOCHREALTIME
known=" "
names=()

step() {
	local name="$1"
	shift
	if [[ $known == *" $name "* ]]; then
		printf 'STEP: two steps are named %s\n' "$name" >&2
		exit 1
	fi
	known+="$name "
	[[ -z ${CI_STEPS:-} || " $CI_STEPS " == *" $name "* ]] || return 0
	names+=("$name")
	while (($(jobs -rp | wc -l) >= JOBS)); do wait -n || true; done
	(
		local begin=$EPOCHREALTIME code=0
		"$@" </dev/null >"$LOGS/$name.log" 2>&1 || code=$?
		printf '%s %s %s\n' "$code" "$begin" "$EPOCHREALTIME" >"$LOGS/$name.done"
	) &
}

seconds() {
	awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1fs", b - a }'
}

report() {
	local name code begin end
	failed=()
	for name in "${names[@]}"; do
		code=1 begin=$started end=$EPOCHREALTIME
		[[ -f $LOGS/$name.done ]] && read -r code begin end <"$LOGS/$name.done"
		if [[ $code == 0 ]]; then
			printf 'ok %s %s\n' "$name" "$(seconds "$begin" "$end")"
		else
			failed+=("$name")
			printf 'FAIL %s %s\n' "$name" "$(seconds "$begin" "$end")"
			cat "$LOGS/$name.log" 2>/dev/null || true
			[[ -f $LOGS/$name.done ]] || printf 'the step stopped before it wrote a result\n'
			printf '\n'
		fi
	done
}

each() {
	local test
	for test in "$@"; do
		step "${test##*/}" bash "$test"
	done
}

shellcheck_at_pin() {
	if ! grep -q "version: ${SHELLCHECK_PIN#v}$" <<<"$(shellcheck --version)"; then
		printf 'shellcheck is %s; CI runs %s\n' "$(shellcheck --version | sed -n 2p)" "$SHELLCHECK_PIN"
		return 1
	fi
	shellcheck "$@"
}

every_test_named() {
	local missing=0 test dir
	while IFS= read -r test; do
		dir="${test%/*}"
		case "$dir" in
		plugins/*/tests) [[ $dir != plugins/*/*/tests && ${test##*/} == test_*.ts ]] && test="$dir/test_*.ts" ;;
		esac
		if ! grep -qF "$test" tools/ci.sh; then
			printf 'not named in tools/ci.sh: %s\n' "$test"
			missing=1
		fi
	done < <(git ls-files 'plugins/*/tests/test_*' 'plugins/*/hooks/test_*' 'tools/test_*' 'tools/*/test_*')
	return "$missing"
}

claim_check() {
	git ls-files -z '*.md' | grep -zv tests/fixtures/ | xargs -0 plugins/whetstone/bin/claim-check
}

validate() {
	"${claude[@]}" plugin validate plugins/dossier &&
		"${claude[@]}" plugin validate plugins/whetstone &&
		"${claude[@]}" plugin validate .
}

if [[ $job == dossier || $job == whetstone || $job == all ]]; then
	step install pnpm install --frozen-lockfile
	wait
fi

if [[ $job == dossier || $job == all ]]; then
	step dossier-tests node_modules/.bin/vitest run --reporter=dot plugins/dossier/tests/test_*.ts
	step format node_modules/.bin/oxfmt --check
	step lint node_modules/.bin/oxlint --deny-warnings
	step types node_modules/.bin/tsc -p .
	each \
		plugins/dossier/hooks/test_lib_dossier_edit.sh \
		plugins/dossier/hooks/test_lib_regen.sh \
		plugins/dossier/hooks/test_session_start.sh \
		plugins/dossier/hooks/test_lib_archive_move.sh \
		plugins/dossier/hooks/test_lib_reconcile.sh \
		plugins/dossier/hooks/test_lib_clear_locks.sh \
		plugins/dossier/hooks/test_lib_ds_check.sh \
		plugins/dossier/hooks/test_lib_z_write.sh \
		plugins/dossier/hooks/test_lib_assert_scaffold.sh \
		plugins/dossier/hooks/test_lib_vm_checks.sh \
		plugins/dossier/hooks/test_closure_parity.sh \
		plugins/dossier/hooks/test_vm6_parity.sh \
		plugins/dossier/hooks/test_lib_assert_grill.sh \
		plugins/dossier/hooks/test_fakeimpl_stop.sh
	step dossier-skills plugins/whetstone/bin/lint-skill plugins/dossier/skills
	step rails bash tools/rails_ceiling.sh
	step tests-named every_test_named
	step validate validate
	step dossier-mod "${claude[@]}" plugin test plugins/dossier
	step pre-push bash tools/test_pre_push.sh
	step dossier-shellcheck shellcheck_at_pin plugins/dossier/hooks/*.sh tools/*.sh .githooks/pre-push
fi

if [[ $job == tools || $job == all ]]; then
	step rows-test "${py[@]}" tools/test_check_rows.py
	step rows "${py[@]}" tools/check_rows.py --base "${ROWS_BASE:-origin/main}"
	step census "${py[@]}" tools/census/test_census.py
	step ruff "${ruff[@]}" check tools
	step pipe-grep-test bash tools/test_pipe_grep.sh
	step pipe-grep bash tools/pipe_grep.sh
fi

if [[ $job == whetstone || $job == all ]]; then
	step whetstone-tests node_modules/.bin/vitest run --reporter=dot plugins/whetstone/tests/test_*.ts
	each \
		plugins/whetstone/tests/test_flake_runner.sh \
		plugins/whetstone/tests/test_verify_clean.sh \
		plugins/whetstone/tests/test_run_slice.sh \
		plugins/whetstone/tests/test_claim_check_cli.sh \
		plugins/whetstone/tests/test_bin_wrappers.sh
	step whetstone-skills plugins/whetstone/bin/lint-skill plugins/whetstone/skills
	step whetstone-mod "${claude[@]}" plugin test plugins/whetstone
	step claim-check claim_check
	step whetstone-shellcheck shellcheck_at_pin plugins/whetstone/skills/*/scripts/*.sh plugins/whetstone/tests/*.sh plugins/whetstone/bin/*
fi

wait
report
total=${#names[@]}
for name in ${CI_STEPS:-}; do
	[[ $known == *" $name "* ]] && continue
	failed+=("unknown-step:$name")
	total=$((total + 1))
done
if ((total == 0)); then
	failed+=("no-step-selected")
fi
took="$(seconds "$started" "$EPOCHREALTIME")"
if [[ ${#failed[@]} -gt 0 ]]; then
	printf 'CI: FAIL %d of %d in %s — %s\n' "${#failed[@]}" "$total" "$took" "${failed[*]}"
	exit 1
fi
printf 'CI: ok %d steps in %s\n' "$total" "$took"
