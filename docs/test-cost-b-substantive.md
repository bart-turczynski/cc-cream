# Subagent cost test B — substantive

Same experiment as test A but with a multi-turn subagent doing real work.
Tests whether cache warms within the subagent and whether cost attribution holds
for a more expensive run.

---

## USER ACTION before running this prompt
Note the cost shown in your statusline right now. You'll need it for the report.

---

## Instructions for Claude

Execute each step in order. Run all bash commands exactly as written.
Your **final response must be only the DATA BLOCK** — no prose, no explanation.

### Step 1 — baseline session metrics (no subagents)

```bash
uv run --python 3.11 python ~/.claude/plugins/cache/centminmod/session-metrics/1.42.0/skills/session-metrics/scripts/session-metrics.py --no-self-cost --no-include-subagents 2>/dev/null | grep -E "^Session|^File|^TOT"
```

### Step 2 — spawn substantive subagent

Use the Agent tool with this prompt exactly:

```
Read the file at /Users/bartturczynski/Projects/temper/docs/EXPLORATION.md in full.
Then write a 3-paragraph summary covering: (1) what cc-cream is and its differentiator,
(2) which fields it plans to display and their defaults, (3) key architectural decisions
and known limitations. Be thorough — aim for 400+ words total.
```

Wait for it to return before continuing.

### Step 3 — post-subagent metrics (run twice)

Without subagents:
```bash
uv run --python 3.11 python ~/.claude/plugins/cache/centminmod/session-metrics/1.42.0/skills/session-metrics/scripts/session-metrics.py --no-self-cost --no-include-subagents 2>/dev/null | grep "^TOT"
```

With subagents:
```bash
uv run --python 3.11 python ~/.claude/plugins/cache/centminmod/session-metrics/1.42.0/skills/session-metrics/scripts/session-metrics.py --no-self-cost 2>/dev/null | grep "^TOT"
```

### Step 4 — find and parse the subagent JSONL

```bash
ls -t ~/.claude/projects/-Users-bartturczynski-Projects-temper/<SESSION_ID>/subagents/*.jsonl 2>/dev/null | head -1
```

Parse it (replace PATH):

```bash
python3 -c "
import json, sys
path = sys.argv[1]
turns, seen = [], set()
with open(path) as f:
    for line in f:
        try:
            d = json.loads(line)
            if d.get('type') == 'assistant':
                u = d['message'].get('usage', {})
                model = d['message'].get('model', '?')
                key = (u.get('input_tokens'), u.get('output_tokens'), u.get('cache_creation_input_tokens'), u.get('cache_read_input_tokens'))
                if key not in seen:
                    seen.add(key)
                    turns.append((u, model))
        except: pass
for i, (u, m) in enumerate(turns, 1):
    print(f'turn{i}: in={u.get(\"input_tokens\",0)} out={u.get(\"output_tokens\",0)} rd={u.get(\"cache_read_input_tokens\",0)} wr={u.get(\"cache_creation_input_tokens\",0)} model={m}')
" <PATH>
```

### Step 5 — output DATA BLOCK

Your entire final response must be exactly this block, filled in. Nothing else.

```
TEST: cost-b-substantive
SESSION_ID: <from Step 1>
SUBAGENT_JSONL: <path>

STATUSLINE_COST_BEFORE: [user fills in]
STATUSLINE_COST_AFTER:  [user fills in after reading this response]

METRICS_BEFORE (orchestrator only):
  in=X  out=X  rd=X  wr=X  total=X  cost=$X.XXXX

METRICS_AFTER_ORCHESTRATOR_ONLY:
  in=X  out=X  rd=X  wr=X  total=X  cost=$X.XXXX

METRICS_AFTER_WITH_SUBAGENTS:
  in=X  out=X  rd=X  wr=X  total=X  cost=$X.XXXX

SUBAGENT_TURNS:
  turn1: in=X out=X rd=X wr=X model=X
  turn2: in=X out=X rd=X wr=X model=X
  ...
```
