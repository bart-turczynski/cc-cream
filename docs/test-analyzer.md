# Test Analyzer — Subagent Cache Warm/Cold

You are analyzing warm vs cold subagent cache experiment results for the cc-cream project.
Read `docs/HANDOFF.md` and `docs/EXPLORATION.md` for full context before starting.

The user will paste DATA BLOCKs from one or more test runs below. Each block comes from
running `@docs/test-cost-a-minimal.md` or `@docs/test-cost-b-substantive.md` in a fresh
terminal session.

---

## What to do

### 1. Parse all data blocks

Extract from each block:
- Session ID, test name (warm-A/B or cold-C/D)
- METRICS_BEFORE, METRICS_AFTER_ORCHESTRATOR_ONLY, METRICS_AFTER_WITH_SUBAGENTS
- All SUBAGENT_TURNS with their in/out/rd/wr/model values
- STATUSLINE_COST_BEFORE / AFTER (if the user filled them in)

### 2. Deduplicate subagent turns

Streaming artifacts produce phantom turns with identical in/rd/wr but different out counts.
Keep only the **highest output** variant of any turn with matching in/rd/wr.

### 3. Compute per-turn cache hit %

For each deduplicated subagent turn:
```
cache_hit_pct = rd / (in + rd + wr) * 100
```

### 4. Compare warm vs cold

Key comparison: **Turn 1 cache reads** for the second/substantive subagent.

| Scenario | Turn 1 rd expected |
|----------|--------------------|
| Warm-B (run after Warm-A within 5 min) | rd > 0 — shared prefix still in cache |
| Cold-D (run >5 min after Cold-C) | rd = 0 — truly cold |

Compute: tokens saved and approximate cost saved from the warm prefix hit.
Use Opus 4.7 pricing for cache reads: $1.50/MTok (vs $3.75/MTok for fresh cache writes).

### 5. Subagent cost attribution

For each test, compute:
```
subagent_cost_delta = METRICS_AFTER_WITH_SUBAGENTS.cost - METRICS_AFTER_ORCHESTRATOR_ONLY.cost
subagent_tokens_delta = METRICS_AFTER_WITH_SUBAGENTS.total - METRICS_AFTER_ORCHESTRATOR_ONLY.total
```

Compare subagent_tokens_delta against the sum of actual subagent turn tokens.
If they match: session-metrics is correctly attributing subagent costs to this session.
If they don't: note the discrepancy and likely cause (e.g. Claude spawned built-in helper subagents during test execution).

### 6. Answer the cost.total_cost_usd question (if statusline cost values are present)

If the user filled in STATUSLINE_COST_BEFORE and STATUSLINE_COST_AFTER:
```
statusline_delta = COST_AFTER - COST_BEFORE
orchestrator_delta = METRICS_AFTER_ORCHESTRATOR_ONLY.cost - METRICS_BEFORE.cost
with_subagents_delta = METRICS_AFTER_WITH_SUBAGENTS.cost - METRICS_BEFORE.cost
```

- If statusline_delta ≈ orchestrator_delta → `cost.total_cost_usd` does NOT include subagent spend
- If statusline_delta ≈ with_subagents_delta → `cost.total_cost_usd` DOES include subagent spend

### 7. Output a findings report

Write a short findings report (bullet points, no prose padding) covering:

- **Warm vs cold turn-1 cache reads**: numbers, what they mean
- **Token/cost savings from warm prefix**: quantified
- **Subagent cost attribution**: does session-metrics delta match JSONL tokens?
- **`cost.total_cost_usd` verdict** (if data available): includes subagents or not
- **Model used**: confirm inheritance from parent
- **Anything unexpected**

Then update `docs/EXPLORATION.md`:
- Replace "still unconfirmed" on `cost.total_cost_usd` if the question is now answered
- Add any refined numbers for warm prefix size or TTL-related observations
- Note any findings that change the cc-cream design decisions

---

## Paste test data blocks below this line
