#!/usr/bin/env bash
# Standalone live timer monitor (optional / alternative to refreshInterval).
#
# With "refreshInterval": 1 set on the statusLine in settings.json, the timers already
# tick live inside Claude Code's own status line, so this script is usually unnecessary.
# It's kept as an alternative for when you want an always-visible readout in a SEPARATE
# terminal window, or in environments where you can't set refreshInterval:
#     bash statusline-monitor.sh
#
# It tracks the most-recently-active session automatically (the transcript JSONL with
# the newest mtime across ~/.claude/projects). No stdin / Claude Code integration
# needed — everything is read from disk. Ctrl-C to quit.

projects_dir="$HOME/.claude/projects"
marker_dir="$HOME/.claude/.session-starts"

RED=$'\033[0;31m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
RST=$'\033[0m'

fmt() { printf "%dm%02ds" $(( $1 / 60 )) $(( $1 % 60 )); }

# Parse a transcript: print "<earliest_epoch> <last_real_user_epoch>".
# last_real_user = newest type=="user" entry WITHOUT toolUseResult (those are tool
# results, not human input) — same rule as statusline-command.sh.
parse_transcript() {
  python3 - "$1" <<'PY' 2>/dev/null
import json, sys, datetime

def epoch(ts):
    if ts.endswith("Z"):
        ts = ts[:-1] + "+00:00"
    return int(datetime.datetime.fromisoformat(ts).timestamp())

earliest = None
last_user = None
try:
    with open(sys.argv[1]) as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            ts = d.get("timestamp")
            if not ts:
                continue
            try:
                e = epoch(ts)
            except Exception:
                continue
            if earliest is None or e < earliest:
                earliest = e
            if d.get("type") == "user" and "toolUseResult" not in d:
                last_user = e
    print(f"{earliest if earliest is not None else 0} {last_user if last_user is not None else 0}")
except Exception:
    print("0 0")
PY
}

cleanup() { printf "\033[?25h\n"; exit 0; }   # restore cursor
trap cleanup INT TERM

printf "\033[?25l"  # hide cursor

cache_key=""
cached_earliest=0
cached_last_user=0

while true; do
  transcript=$(ls -t "$projects_dir"/*/*.jsonl 2>/dev/null | head -n1)
  now=$(date +%s)

  if [ -z "$transcript" ]; then
    printf "\r\033[K${DIM}no active Claude Code session found${RST}"
    sleep 1
    continue
  fi

  sid=$(basename "$transcript" .jsonl)
  slug=$(basename "$(dirname "$transcript")")
  project=$(basename "$(echo "$slug" | tr '-' '/')")
  mtime=$(stat -f %m "$transcript" 2>/dev/null)

  # Re-parse only when the transcript actually changed (event-driven); otherwise
  # the per-second loop is just arithmetic, so it stays cheap on large transcripts.
  key="$transcript:$mtime"
  if [ "$key" != "$cache_key" ]; then
    read -r cached_earliest cached_last_user < <(parse_transcript "$transcript")
    cache_key="$key"
  fi

  # session: prefer the marker the status line writes; fall back to first transcript ts.
  marker="$marker_dir/$sid"
  start_ts=""
  [ -f "$marker" ] && start_ts=$(cat "$marker" 2>/dev/null)
  [ -z "$start_ts" ] && [ "$cached_earliest" != "0" ] && start_ts="$cached_earliest"

  if [ -n "$start_ts" ]; then
    s_elapsed=$(( now - start_ts ))
    s_fmt=$(fmt "$s_elapsed")
    if [ "$(( s_elapsed / 60 ))" -ge 50 ]; then
      session_str="${RED}session:${s_fmt}${RST}"
    else
      session_str="session:${s_fmt}"
    fi
  else
    session_str="session:--"
  fi

  # idle: now - last real user message
  if [ "$cached_last_user" != "0" ]; then
    idle_str="idle:$(fmt $(( now - cached_last_user )))"
  else
    idle_str="idle:--"
  fi

  printf "\r\033[K${DIM}[%s ~ %s]${RST} ${BOLD}%s${RST} | ${BOLD}%s${RST}" \
    "$project" "${sid:0:8}" "$session_str" "$idle_str"
  sleep 1
done
