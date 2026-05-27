#!/usr/bin/env bash
#
# fp-orchestrate.sh — a deterministic shell around a non-deterministic worker.
#
# The model: this script is a deterministic *conductor*. Everything it decides
# (which ticket is ready, in what order, whether the gate passed, what to do on
# failure) is pure function of `fp issue list` + git + the gate's exit code.
# The actual feature work — `fp run <id>`, which boots Claude Code on the issue —
# is a *stochastic* step. The determinism here buys sequencing, gating and
# failure containment. It does NOT buy correctness of the feature; only the gate
# does that. So this is designed failure-first: the happy path takes care of
# itself, every other path has one boring, predictable outcome.
#
# Per-ticket transaction:
#   1. pick the next READY ticket: status==todo AND every dependency is done
#   2. cut an isolated branch  auto/<shortId>  off the integration branch
#   3. run the worker (fp run <id>) on that branch
#   4. run the GATE (npm test) against the result
#   5. green -> commit, merge into integration branch, mark the issue done
#      red   -> leave the work quarantined on auto/<shortId>, mark a comment,
#               and (default) STOP. The failed ticket stays in-progress, so it
#               is never silently re-picked and never poisons a dependent's base.
#
# A ticket left in-progress is the quarantine marker: ready-selection only ever
# picks `todo`, so --keep-going naturally steps over it instead of looping on it.
#
# Re-running is safe: a clean ticket re-derives its branch from the (possibly
# advanced) integration tip. Nothing is keyed to wall-clock or run order.
#
# Usage:
#   scripts/fp-orchestrate.sh [options]
#
# Options:
#   --parent <shortId|id>  Only consider children of this epic (e.g. lwiwezhg).
#   --once                 Do a single ticket, then exit.
#   --keep-going           On a red gate, quarantine + continue to the next
#                          ready ticket instead of stopping (default: fail-fast).
#   --dry-run              Print the ready queue and the ticket order; touch
#                          nothing. Always safe.
#   -h, --help             This help.
#
# Environment overrides:
#   GATE_CMD      gate command, must exit 0 on success   (default: "npm test")
#   WORK_CMD      worker, invoked as `$WORK_CMD <id>`     (default: "fp run")
#   MAX_ATTEMPTS  worker attempts per ticket before red   (default: 1)
#   RESET_ON_RETRY  1 = git reset --hard the branch before each retry; 0 = let
#                   the worker continue from its partial state   (default: 0)
#   INTEGRATION_BRANCH  branch to cut from / merge into   (default: current branch)
#
# Requires: fp, git, jq, plus whatever GATE_CMD needs (here: npm). Bash 3.2+ (macOS ok).

set -euo pipefail

# ---- config ---------------------------------------------------------------
GATE_CMD="${GATE_CMD:-npm test}"
WORK_CMD="${WORK_CMD:-fp run}"
MAX_ATTEMPTS="${MAX_ATTEMPTS:-1}"
RESET_ON_RETRY="${RESET_ON_RETRY:-0}"
INTEGRATION_BRANCH="${INTEGRATION_BRANCH:-}"
PARENT=""
PARENT_ID=""
ONCE=0
KEEP_GOING=0
DRY_RUN=0

# ---- tiny helpers ---------------------------------------------------------
c_blue=$'\033[34m'; c_green=$'\033[32m'; c_red=$'\033[31m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
log()  { printf '%s\n' "$*" >&2; }
info() { log "${c_blue}==>${c_off} $*"; }
ok()   { log "${c_green}OK ${c_off} $*"; }
err()  { log "${c_red}ERR${c_off} $*"; }
dim()  { log "${c_dim}$*${c_off}"; }
die()  { err "$*"; exit 1; }
# fp metadata calls are best-effort: a failed status/comment update must not
# crash the conductor mid-transaction.
fp_try() { "$@" >/dev/null 2>&1 || log "${c_dim}(warn) fp call failed: $*${c_off}"; }

CACHE=""
cleanup() { [[ -n "$CACHE" && -f "$CACHE" ]] && rm -f "$CACHE"; }
trap cleanup EXIT

# ---- arg parsing ----------------------------------------------------------
while [[ $# -gt 0 ]]; do
  case "$1" in
    --parent)     PARENT="${2:?--parent needs a value}"; shift 2 ;;
    --once)       ONCE=1; shift ;;
    --keep-going) KEEP_GOING=1; shift ;;
    --dry-run)    DRY_RUN=1; shift ;;
    -h|--help)    sed -n '2,/^set -euo/p' "$0" | sed 's/^# \{0,1\}//; s/^#$//'; exit 0 ;;
    *)            die "unknown option: $1 (try --help)" ;;
  esac
done

# ---- preflight ------------------------------------------------------------
for bin in fp git jq; do command -v "$bin" >/dev/null || die "missing dependency: $bin"; done
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "not inside a git work tree"
[[ -e .fp || -e "$(git rev-parse --show-toplevel)/.fp" ]] || die "no .fp/ here — run from the fp project root"

if [[ -z "$INTEGRATION_BRANCH" ]]; then
  INTEGRATION_BRANCH="$(git branch --show-current)" || true
  [[ -n "$INTEGRATION_BRANCH" ]] || die "detached HEAD; set INTEGRATION_BRANCH explicitly"
fi

# Refuse to run with a dirty tree: the worker and the merge both assume a clean
# base, and we will not trample uncommitted work. (--dry-run is exempt.)
if [[ "$DRY_RUN" -eq 0 ]]; then
  if ! git diff --quiet || ! git diff --cached --quiet; then
    die "working tree is dirty — commit or stash first (orchestrator needs a clean base)"
  fi
fi

CACHE="$(mktemp -t fp-orch.XXXXXX)"
refresh() { fp issue list --format json >"$CACHE"; }

# Resolve --parent (shortId or id) to a full id once.
if [[ -n "$PARENT" ]]; then
  refresh
  PARENT_ID="$(jq -r --arg s "$PARENT" '.issues[] | select(.shortId==$s or .id==$s) | .id' "$CACHE" | head -n1)"
  [[ -n "$PARENT_ID" ]] || die "no issue with shortId/id '$PARENT'"
fi

# LEAVES-IN-SCOPE: todo issues that are real units of work — i.e. NOT containers
# (an issue whose id is some other issue's parent is an epic, never run directly),
# optionally restricted to children of PARENT_ID. Shared by ready_ids (adds the
# deps-satisfied filter) and remaining_todos (the blocked-vs-drained test), so both
# reason over the same scope. NB: jq's `|` is lowest precedence, so the sort key
# MUST be parenthesised — `(.priority|prank)` — or it pipes priority into .createdAt.
JQ_LEAVES='
  def prank: {"high":0,"medium":1,"low":2}[(. // "")] // 3;
  .issues as $all
  | ($all | map(.parent) | map(select(. != null)) | unique) as $epics
  | ($all | map(select(.status=="done") | .id))          as $done
  | $all
  | map(select(.status=="todo"))
  | map(select(.id | IN($epics[]) | not))
  | (if $parent=="" then . else map(select(.parent==$parent)) end)
'
ready_ids() {
  jq -r --arg parent "$PARENT_ID" "$JQ_LEAVES"'
    | map(select((.dependencies - $done) | length == 0))
    | sort_by((.priority|prank), .createdAt)
    | .[].id' "$CACHE"
}
field_of() { jq -r --arg id "$1" --arg f "$2" '.issues[] | select(.id==$id) | .[$f] // ""' "$CACHE"; }
# Workable leaf todos still in scope (ignores deps). >0 with an empty ready queue
# means genuinely blocked on unmet/quarantined deps; ==0 means scope is drained.
remaining_todos() { jq -r --arg parent "$PARENT_ID" "$JQ_LEAVES"' | length' "$CACHE"; }

# ---- one ticket, transactionally -----------------------------------------
# returns 0 = gate green & merged ; 1 = red & quarantined
run_one() {
  local id="$1" short title branch attempt rc
  short="$(field_of "$id" shortId)"
  title="$(field_of "$id" title)"
  branch="auto/${short}"

  info "ticket ${short} — ${title}"
  if [[ "$DRY_RUN" -eq 1 ]]; then dim "    (dry-run) would branch ${branch} off ${INTEGRATION_BRANCH}, run '${WORK_CMD} ${id}', gate '${GATE_CMD}'"; return 0; fi

  fp_try fp issue update --status in-progress "$id"

  rc=1
  for (( attempt=1; attempt<=MAX_ATTEMPTS; attempt++ )); do
    if [[ "$attempt" -eq 1 ]]; then
      # fresh isolated branch off the (possibly advanced) integration tip
      git switch -C "$branch" "$INTEGRATION_BRANCH" >/dev/null 2>&1
    elif [[ "$RESET_ON_RETRY" -eq 1 ]]; then
      info "retry ${attempt}/${MAX_ATTEMPTS} (reset to ${INTEGRATION_BRANCH})"
      git switch "$branch" >/dev/null 2>&1; git reset --hard "$INTEGRATION_BRANCH" >/dev/null 2>&1
    else
      info "retry ${attempt}/${MAX_ATTEMPTS} (continue from partial state)"
      git switch "$branch" >/dev/null 2>&1
    fi

    info "worker: ${WORK_CMD} ${id}"
    if ! $WORK_CMD "$id"; then dim "    worker exited non-zero (attempt ${attempt})"; fi

    info "gate: ${GATE_CMD}"
    if ( eval "$GATE_CMD" ); then rc=0; break; fi
    err "gate failed (attempt ${attempt}/${MAX_ATTEMPTS})"
  done

  if [[ "$rc" -eq 0 ]]; then
    # capture anything the worker left uncommitted; if it already committed, this is a no-op
    git add -A && git commit -q -m "feat(${short}): ${title}" || true
    git switch "$INTEGRATION_BRANCH" >/dev/null 2>&1
    git merge --no-ff "$branch" -m "merge ${short}: ${title}" >/dev/null
    git branch -d "$branch" >/dev/null 2>&1 || true
    fp_try fp issue update --status done "$id"
    fp_try fp comment add "$id" "Gate '${GATE_CMD}' passed; merged ${branch} into ${INTEGRATION_BRANCH}."
    ok "ticket ${short} done & merged"
    return 0
  fi

  # red: quarantine the work, leave the issue in-progress as the marker, return to base
  git switch "$INTEGRATION_BRANCH" >/dev/null 2>&1
  fp_try fp comment add "$id" "Gate '${GATE_CMD}' failed after ${MAX_ATTEMPTS} attempt(s). Work quarantined on branch ${branch}; issue left in-progress for human review."
  err "ticket ${short} quarantined on ${branch} (issue left in-progress)"
  return 1
}

# ---- main loop ------------------------------------------------------------
info "integration branch: ${INTEGRATION_BRANCH}   gate: ${GATE_CMD}   worker: ${WORK_CMD}   attempts: ${MAX_ATTEMPTS}"
[[ "$DRY_RUN" -eq 1 ]] && info "DRY RUN — no branches, no worker, no fp writes"

while true; do
  refresh
  QUEUE=()
  while IFS= read -r line; do [[ -n "$line" ]] && QUEUE+=("$line"); done < <(ready_ids)

  if [[ "${#QUEUE[@]}" -eq 0 ]]; then
    if [[ "$(remaining_todos)" -gt 0 ]]; then
      err "no READY tickets, but todos remain — blocked on unmet/quarantined dependencies. Stopping."
      exit 2
    fi
    ok "backlog drained — nothing ready and no todos left."
    exit 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    info "ready queue (${#QUEUE[@]}):"
    for id in "${QUEUE[@]}"; do dim "    $(field_of "$id" shortId)  [$(field_of "$id" priority)]  $(field_of "$id" title)"; done
    exit 0
  fi

  if run_one "${QUEUE[0]}"; then
    [[ "$ONCE" -eq 1 ]] && { ok "--once: stopping after one ticket"; exit 0; }
    continue
  else
    if [[ "$KEEP_GOING" -eq 1 ]]; then
      info "--keep-going: moving to next ready ticket"
      continue
    fi
    die "fail-fast: stopping at first red gate (re-run after fixing, or pass --keep-going)"
  fi
done
