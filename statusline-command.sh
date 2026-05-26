#!/usr/bin/env bash
# Claude Code status line — model, tokens, cache hit %, context %, session + idle timers

input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // "unknown"')
session_id=$(echo "$input" | jq -r '.session_id // empty')

total_in=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_out=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
total_all=$(( total_in + total_out ))

cache_read=$(echo "$input" | jq -r '.context_window.current_usage.cache_read_input_tokens // 0')
cache_write=$(echo "$input" | jq -r '.context_window.current_usage.cache_creation_input_tokens // 0')
cur_in=$(echo "$input" | jq -r '.context_window.current_usage.input_tokens // 0')

total_cache_base=$((cache_read + cache_write + cur_in))
if [ "$total_cache_base" -gt 0 ]; then
  cache_pct=$(awk "BEGIN { printf \"%.0f\", ($cache_read / $total_cache_base) * 100 }")
else
  cache_pct="0"
fi

used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')

if [ "$total_all" -lt 80000 ]; then
  total_str=$(printf "\033[0;32mtotal:%d\033[0m" "$total_all")
elif [ "$total_all" -le 120000 ]; then
  total_str=$(printf "\033[0;33mtotal:%d\033[0m" "$total_all")
else
  total_str=$(printf "\033[0;31mtotal:%d\033[0m" "$total_all")
fi

marker_dir="$HOME/.claude/.session-starts"
mkdir -p "$marker_dir" 2>/dev/null
now=$(date +%s)

session_str=""
if [ -n "$session_id" ]; then
  marker="$marker_dir/$session_id"
  if [ ! -f "$marker" ]; then
    echo "$now" > "$marker"
  fi
  start_ts=$(cat "$marker" 2>/dev/null)
  if [ -n "$start_ts" ]; then
    elapsed=$(( now - start_ts ))
    mins=$(( elapsed / 60 ))
    secs=$(( elapsed % 60 ))
    if [ "$mins" -ge 50 ]; then
      session_str=$(printf "\033[0;31msession:%dm%02ds\033[0m" "$mins" "$secs")
    else
      session_str=$(printf "session:%dm%02ds" "$mins" "$secs")
    fi
  fi
fi

# Idle = seconds since the last real user message in THIS session's transcript.
# Skips type=="user" entries with toolUseResult (those are tool results, not user input).
# The last-user timestamp only changes when the transcript changes, so cache it keyed by
# the transcript's mtime. With refreshInterval=1 the script runs every second; this keeps
# those ticks cheap (no python spawn per second — we just recompute now - cached_epoch).
transcript=$(echo "$input" | jq -r '.transcript_path // empty')
idle_str=""
if [ -n "$transcript" ] && [ -f "$transcript" ]; then
  mtime=$(stat -f %m "$transcript" 2>/dev/null)
  cache="$marker_dir/${session_id:-_}.idle"
  last_user=""
  if [ -f "$cache" ]; then
    read -r c_mtime c_epoch < "$cache"
    [ "$c_mtime" = "$mtime" ] && last_user="$c_epoch"
  fi
  if [ -z "$last_user" ]; then
    last_user=$(python3 - "$transcript" <<'PY' 2>/dev/null
import json, sys, datetime
last = None
try:
    with open(sys.argv[1]) as f:
        for line in f:
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") == "user" and "toolUseResult" not in d:
                ts = d.get("timestamp")
                if ts:
                    last = ts
    if last:
        if last.endswith("Z"):
            last = last[:-1] + "+00:00"
        print(int(datetime.datetime.fromisoformat(last).timestamp()))
except Exception:
    pass
PY
)
    [ -n "$last_user" ] && [ -n "$mtime" ] && printf "%s %s\n" "$mtime" "$last_user" > "$cache" 2>/dev/null
  fi
  if [ -n "$last_user" ]; then
    elapsed=$(( now - last_user ))
    mins=$(( elapsed / 60 ))
    secs=$(( elapsed % 60 ))
    idle_str=$(printf "idle:%dm%02ds" "$mins" "$secs")
  fi
fi

metrics="${total_str} in:${total_in} out:${total_out}"
if [ -n "$used_pct" ]; then
  metrics="${metrics} ctx:$(printf '%.0f' "$used_pct")%"
fi
metrics="${metrics} cache:${cache_pct}%"

parts=("$model" "$metrics")
[ -n "$session_str" ] && parts+=("$session_str")
[ -n "$idle_str" ] && parts+=("$idle_str")

result=""
for part in "${parts[@]}"; do
  if [ -z "$result" ]; then
    result="$part"
  else
    result="$result | $part"
  fi
done

printf "%s" "$result"
