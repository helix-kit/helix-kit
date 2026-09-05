# SPDX-License-Identifier: AGPL-3.0-only
#
# Shared PASS/FAIL harness for the experimental end-to-end scripts.
#
# Source it, run checks, then call `print_summary`. The sourcing script decides
# what to check and provides an optional `diagnostics` function, which is invoked
# on an aborted run and on a failing summary.
#
#   source ../lib/e2e-checks.sh
#   check_match "alice resolves" '^alice:' -- getent passwd alice
#   print_summary   # exits non-zero if anything failed

PASSED=0
FAILED=0
FAILURES=()

if [[ -t 1 ]]; then
    C_PASS=$'\033[32m'; C_FAIL=$'\033[31m'; C_HEAD=$'\033[1m'; C_OFF=$'\033[0m'
else
    C_PASS=''; C_FAIL=''; C_HEAD=''; C_OFF=''
fi

section() { printf '\n%s== %s ==%s\n' "$C_HEAD" "$1" "$C_OFF"; }
pass()    { PASSED=$((PASSED + 1)); printf '%s[PASS]%s %s\n' "$C_PASS" "$C_OFF" "$1"; }
fail()    { FAILED=$((FAILED + 1)); FAILURES+=("$1"); printf '%s[FAIL]%s %s\n' "$C_FAIL" "$C_OFF" "$1"; }

# run_diagnostics calls the sourcing script's diagnostics hook, if it has one.
run_diagnostics() {
    if declare -F diagnostics >/dev/null; then
        diagnostics
    fi
}

# die aborts the run: the environment is broken, so no verdict is meaningful.
die() {
    printf '%s[ABORT]%s %s\n' "$C_FAIL" "$C_OFF" "$1"
    run_diagnostics
    exit 1
}

# indent reformats captured output so it lines up under a failure report.
_indent() { printf '%s' "${1//$'\n'/$'\n'               }"; }

# check_ok NAME -- CMD...        the command must succeed
check_ok() {
    local name="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    local out
    if out=$("$@" 2>&1); then
        pass "$name"
    else
        fail "$name"
        printf '       command: %s\n       output: %s\n' "$*" "$(_indent "$out")"
    fi
}

# check_fail NAME -- CMD...      the command must NOT succeed
check_fail() {
    local name="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    local out
    if out=$("$@" 2>&1); then
        fail "$name"
        printf '       command unexpectedly succeeded: %s\n       output: %s\n' "$*" "$(_indent "$out")"
    else
        pass "$name"
    fi
}

# check_match NAME PATTERN -- CMD...    stdout must match the extended regex
check_match() {
    local name="$1" pattern="$2"; shift 2; [[ "${1:-}" == "--" ]] && shift
    local out
    out=$("$@" 2>&1)
    if grep -Eq -- "$pattern" <<<"$out"; then
        pass "$name"
    else
        fail "$name"
        printf '       expected match: %s\n       command: %s\n       output: %s\n' \
            "$pattern" "$*" "$(_indent "$out")"
    fi
}

# check_nomatch NAME PATTERN -- CMD...  stdout must NOT match
check_nomatch() {
    local name="$1" pattern="$2"; shift 2; [[ "${1:-}" == "--" ]] && shift
    local out
    out=$("$@" 2>&1)
    if grep -Eq -- "$pattern" <<<"$out"; then
        fail "$name"
        printf '       unexpected match: %s\n       output: %s\n' "$pattern" "$(_indent "$out")"
    else
        pass "$name"
    fi
}

# wait_healthy SERVICE [TIMEOUT]  waits for a compose service to report healthy
wait_healthy() {
    local service="$1" timeout="${2:-120}" id status
    for ((i = 0; i < timeout; i++)); do
        id=$(docker compose ps -q "$service" 2>/dev/null)
        if [[ -n "$id" ]]; then
            status=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$id" 2>/dev/null)
            [[ "$status" == "healthy" || "$status" == "running" ]] && return 0
            [[ "$status" == "exited" ]] && return 1
        fi
        sleep 1
    done
    return 1
}

# retry_until TIMEOUT -- CMD...   polls until the command succeeds
retry_until() {
    local timeout="$1"; shift; [[ "${1:-}" == "--" ]] && shift
    for ((i = 0; i < timeout; i++)); do
        "$@" >/dev/null 2>&1 && return 0
        sleep 1
    done
    return 1
}

# print_summary reports the tally and exits non-zero if anything failed.
print_summary() {
    section "SUMMARY"
    printf '%s%d passed%s, %s%d failed%s\n' "$C_PASS" "$PASSED" "$C_OFF" \
        "$([[ $FAILED -gt 0 ]] && echo "$C_FAIL" || echo '')" "$FAILED" "$C_OFF"

    if [[ $FAILED -gt 0 ]]; then
        printf '\nFailed checks:\n'
        printf '  - %s\n' "${FAILURES[@]}"
        run_diagnostics
        exit 1
    fi
}
