# cc-cream — Session Handoff

**Date:** 2026-05-26  
**Context:** exploration + subagent cache experiments. Pick up here in a fresh session.

---

## Where we are

Plugin is not yet scaffolded. `temper/` has a git repo (initial commit done) with:
- `docs/EXPLORATION.md` — full design decisions, field table, architecture, competitive intel
- `docs/test-cost-a-minimal.md` / `docs/test-cost-b-substantive.md` — test execution prompts
- `docs/test-analyzer.md` — analyzer prompt (paste test blobs into a fresh Claude session)
- MVP statusline scripts already exist in repo root (`statusline-command.sh`, `statusline-monitor.sh`)

**Next engineering task:** scaffold the `cc-cream` plugin repo (see EXPLORATION.md "Next session: start here").

---

## Key findings — subagent cache experiments

All confirmed empirically this session:

### Cache isolation
- Subagents have **fully isolated caches** from the parent session. The parent's accumulated cache (e.g. 88k tokens) is not accessible to any subagent.
- Only the **shared base system prompt prefix** (~5k–7k tokens for the current Claude Code + model combo) is accessible to sibling subagents.

### Cold vs warm starts
- **First subagent in a session** starts completely cold: `cache_read = 0`, writes entire system prompt to cache.
- **Subsequent subagents** launched within the 5-min TTL can read the shared prefix from cache. In tests: rd ≈ 5,000–6,500 tokens on first call.
- This cross-session warming only applies to the shared prefix, not to anything conversation-specific.

### TTL
- Subagents use **5-minute TTL** even on a Claude.ai subscription (confirmed in docs). Main session gets 1-hour TTL.
- Practical consequence: if the user pauses >5 minutes, the next subagent is fully cold regardless of parent cache state.

### Model inheritance
- Generic `Agent` spawns inherit the **parent session's model**. On Opus 4.7 sessions, every subagent runs Opus 4.7.
- Exception: built-in `Explore` subagent is pinned to Haiku.

### JSONL separation
- Subagent tokens are written to **separate JSONL files**: `<session-id>/subagents/agent-<id>.jsonl`
- Main session JSONL has no record of subagent turns (confirmed by timestamp gap inspection).
- session-metrics includes them when run with defaults; `--no-include-subagents` excludes them.

### What the statusline sees
- `context_window.total_input_tokens` = total input in the **current turn's context** (including cached reads). NOT session cumulative.
- `cache_read_input_tokens / total_input_tokens` = the cache% the statusline shows.
- After a subagent returns, the statusline reflects the **orchestrator's next call**, not the subagent's cache performance.

### Open question
- **`cost.total_cost_usd` — does it include subagent spend?** Still unconfirmed. MVP statusline doesn't display cost. To test: add cost to the statusline, note it before and after a subagent run, compare against session-metrics with vs without subagents.

---

## Decisions made

- Lines added/removed: **out of scope**. Not related to cache/token economics.
- Token speeds (tok/s): **shelved**. Requires inter-invocation state.
- subagentStatusLine: **v2 only**.
- Rate limits: **five_hour on by default** (most urgent), **seven_day off by default**.
- Idle timer: needs `refreshInterval` in `settings.json` to tick live between turns.
- Cache warmth indicator: color only (green/yellow/red), no countdown. Going negative post-TTL is awkward UX.

---

## Test protocol — warm vs cold (pending)

Four runs across four fresh terminal tabs. Use `@docs/test-cost-a-minimal.md` or `@docs/test-cost-b-substantive.md` as the prompt.

| Run | File | Timing | Expected |
|-----|------|--------|----------|
| Warm-A | test-cost-a-minimal | First, no wait | Subagent Turn 1: rd=0 (cold) |
| Warm-B | test-cost-b-substantive | Immediately after Warm-A (<5 min) | Subagent Turn 1: rd>0 (partial warm from A's prefix) |
| Cold-C | test-cost-a-minimal | Wait >5 min after any prior subagent | Subagent Turn 1: rd=0 (cold) |
| Cold-D | test-cost-b-substantive | Wait >5 min after Cold-C | Subagent Turn 1: rd=0 (cold) |

After all four runs, paste all four DATA BLOCKs into a fresh session with `@docs/test-analyzer.md`.

**Goal:** Quantify the token/cost savings from the warm shared prefix. Confirm cold baseline.

**Bonus:** If you want to answer the `cost.total_cost_usd` question during these tests, temporarily add cost output to the statusline and note the value before/after each subagent spawns.

---

## Next steps (in priority order)

1. Run the warm/cold tests and update `docs/EXPLORATION.md` with findings.
2. Scaffold the `cc-cream` plugin repo — see `docs/EXPLORATION.md` "Next session: start here".
3. Answer the `cost.total_cost_usd` question (optional, non-blocking).
