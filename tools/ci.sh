#!/usr/bin/env bash
set -euo pipefail

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

LOGS="$(mktemp -d "${TMPDIR:-/tmp}/ci.XXXXXX")"
trap 'rm -rf "$LOGS"' EXIT
passed=0
failed=()
known=" "

step() {
	local name="$1"
	shift
	known+="$name "
	[[ -z ${CI_STEPS:-} || " $CI_STEPS " == *" $name "* ]] || return 0
	if "$@" >"$LOGS/$name" 2>&1; then
		passed=$((passed + 1))
		printf 'ok %s\n' "$name"
	else
		failed+=("$name")
		printf 'FAIL %s\n' "$name"
		cat "$LOGS/$name"
		printf '\n'
	fi
}

each() {
	local rc=0 test
	for test in "$@"; do
		printf '== %s\n' "$test"
		bash "$test" || rc=1
	done
	return "$rc"
}

shellcheck_at_pin() {
	if ! shellcheck --version | grep -q "version: ${SHELLCHECK_PIN#v}$"; then
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
fi

if [[ $job == dossier || $job == all ]]; then
	step dossier-tests node_modules/.bin/vitest run --reporter=dot plugins/dossier/tests/test_*.ts
	step format node_modules/.bin/oxfmt --check
	step lint node_modules/.bin/oxlint --deny-warnings
	step types node_modules/.bin/tsc -p .
	step dossier-shell each \
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
fi

if [[ $job == whetstone || $job == all ]]; then
	step whetstone-tests node_modules/.bin/vitest run --reporter=dot plugins/whetstone/tests/test_*.ts
	step whetstone-shell each \
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

for name in ${CI_STEPS:-}; do
	[[ $known == *" $name "* ]] || failed+=("unknown-step:$name")
done
total=$((passed + ${#failed[@]}))
if [[ ${#failed[@]} -gt 0 ]]; then
	printf 'CI: FAIL %d of %d — %s\n' "${#failed[@]}" "$total" "${failed[*]}"
	exit 1
fi
printf 'CI: ok %d steps\n' "$total"
