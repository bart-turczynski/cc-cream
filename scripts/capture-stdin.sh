#!/usr/bin/env bash
# TEMPORARY S0 capture wrapper (cc-cream). While wired into settings.json as the
# statusLine command, it captures ONE fully-populated subscriber snapshot of the
# JSON Claude Code pipes on stdin -> fixtures/subscriber.golden.json, then puts
# the user's original statusLine command back (self-restore, runs once). It
# always passes stdin through to the original statusline so the bar keeps
# rendering. Delete this file and the capture-related plumbing after S0 closes.
SETTINGS="$HOME/.claude/settings.json"
ORIGINAL='bash /Users/user/.claude/statusline-command.sh'
FIXTURE='/Users/user/Projects/temper/fixtures/subscriber.golden.json'

IN=$(cat)

if [ ! -s "$FIXTURE" ]; then
  # Accept only a complete snapshot (current_usage present, used_percentage
  # numeric, cost > 0, rate_limits present) so the golden fixture carries every
  # field the default segments read.
  if printf '%s' "$IN" | python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
except Exception:
    sys.exit(1)
cw = d.get("context_window") or {}
ok = (cw.get("current_usage") is not None
      and isinstance(cw.get("used_percentage"), (int, float))
      and (d.get("cost") or {}).get("total_cost_usd", 0) > 0
      and bool(d.get("rate_limits")))
sys.exit(0 if ok else 1)
'; then
    printf '%s' "$IN" > "$FIXTURE"
    # Self-restore: point statusLine back at the original command.
    python3 - "$SETTINGS" "$ORIGINAL" <<'PY'
import json, sys
path, original = sys.argv[1], sys.argv[2]
d = json.load(open(path))
d.setdefault("statusLine", {})["command"] = original
json.dump(d, open(path, "w"), indent=2)
open(path, "a").write("\n")
PY
  fi
fi

printf '%s' "$IN" | bash /Users/user/.claude/statusline-command.sh
