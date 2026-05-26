# cc-cream — Product Requirements (v1)

**Product:** cc-cream — a Claude Code status-line plugin.
**Tagline:** C.R.E.A.M. — Cache Rules Everything Around Me.
**Status:** PRD draft, 2026-05-27. Business-logic / product scope only — engineering/technical design is a separate round (see [Open technical questions](#open-technical-questions-next-round)).
**Sources:** Decisions captured in this session's product Q&A. Facts verified against `code.claude.com/docs/en/statusline` and `code.claude.com/docs/en/prompt-caching` on 2026-05-27. Background in `docs/EXPLORATION.md`, `docs/HANDOFF.md`.

---

## 1. What it is

A single (or auto-wrapping) status-line bar for Claude Code that helps a user **manage a session to avoid rate limits and minimise token burn**, with cache economics as the organizing story. It runs as a native Claude Code plugin, reads the JSON Claude Code pipes to the status-line command on stdin, and prints a formatted line. Zero token cost — the model never sees the output.

## 2. Who it's for (positioning)

**Primary: Claude Pro/Max subscribers.** Their usage is included in the plan, so a warm cache saves them *no dollars* — it buys **speed** and, critically, **rate-limit headroom** (the 5h and weekly windows are token-counted). The bar's job for them is: *don't get throttled, don't waste your budget reprocessing context you could have cached, and don't let the context window fill to the point the model degrades.*

**Secondary: API-key / pay-per-token users.** Served where it's cheap to do so (the same fields work). Where per-token accounting gets tricky, we **fall back to a generalizable, notional "what-if" calculation** rather than instrumenting every token through an API-billing lens.

**Explicitly deferred:** true per-token API tokenomics. Shelved as a later feature; v1 does not try to be an accurate billing meter.

### Thesis caveat (verified)
On a subscription, "usage is included in your plan rather than billed per token." So the literal cash-savings framing of C.R.E.A.M. is notional for our primary audience. We keep the cache-economics *brand and glance* (cache health, context discipline) but the **payoff we sell subscribers is limit-avoidance and speed, not dollars.**

## 3. Goals / non-goals

**Goals (v1)**
- Preserve the existing MVP row verbatim and extend it with rate limits and notional cost.
- Make the bar an *early-warning system* for rate limits, not just a passive readout.
- Make cache health and context fullness glanceable, with opinionated, evidence-aware color zones.
- Be opinionated by default; remain fully tunable via a hand-edited config file for power users.

**Non-goals (v1)**
- Accurate per-token API cost accounting.
- Any subagent UI (main bar or `subagentStatusLine`).
- A configuration front-end / TUI / theme engine.
- Reorderable segments or custom color themes as a *documented* feature (the schema may allow it; we don't build UX for it).

---

## 4. What we measure and show

### 4.1 Default fields (on out of the box)

Preserves the MVP — `Opus 4.7 (1M context) | total:38220 in:38036 out:184 ctx:19% cache:0% | session:0m18s | idle:0m09s` — and adds rate limits + cost.

| Segment | Shown as | Source field | Color logic | Notes |
|---|---|---|---|---|
| Model | `Opus 4.7 (1M context)` | `model.display_name` | none | as today |
| Total tokens | `total:38k` | `context_window.total_input_tokens + total_output_tokens` | neutral (see ctx for the warning color) | **compact by default** |
| Input | `in:38k` | `context_window.total_input_tokens` | neutral | compact |
| Output | `out:184` | `context_window.total_output_tokens` | neutral | compact |
| Context % | `ctx:19%` | `context_window.used_percentage` | **<40% green · 40–50% amber · ≥50% red** (interim — see research earmark) | percentage-based so it's model-independent (200k vs 1M) |
| Cache % | `cache:95%` | `cache_read / (cache_read + cache_creation + input)` of `current_usage` | **suppressed/neutral until first cache read; then absolute** (proposed: ≥80% green · 50–80% amber · <50% red) | own on/off toggle; see §4.3 |
| Session timer | `session:0m18s` | wall-clock since first render (marker file) | red ≥50m (≈ approaching the 1h subscription TTL) | as today |
| Idle timer | `idle:0m09s` | now − last real user message (transcript) | **neutral** (informational only) | as today |
| 5-hour limit | `5h:23%·2h14m` | `rate_limits.five_hour.used_percentage` + `resets_at` | %+countdown, **>75% amber · >90% red** (proposed) | absent for API users → segment hidden gracefully |
| Weekly limit | `7d:41%·4d` | `rate_limits.seven_day.used_percentage` + `resets_at` | same as 5h | now on by default (overrides earlier "7d off") |
| Cost | `~$4.50` | `cost.total_cost_usd` | neutral | **labeled notional** (`~`); for subscribers reads as "API-equivalent value used"; client-side estimate, may differ from actual bill |

### 4.2 Optional fields (shipped in v1, off by default, toggle-on)

| Segment | Source | Notes |
|---|---|---|
| Effort level | `effort.level` (low…max) | absent when the model doesn't support it; effort changes also invalidate cache (token-burn link) |
| Thinking state | `thinking.enabled` | boolean indicator only |

Everything else from the stdin schema is **deferred** (see [Backlog](#7-backlog--v2)).

### 4.3 Color & threshold philosophy

cc-cream takes opinions; that's the point. Default zones:

- **Context fullness (`ctx:%`)** — `<40 green / 40–50 amber / ≥50 red`. This is deliberately aggressive (Claude Code's own example reds at 90%) because of the heuristic that model quality degrades well before the window is "full." **This is an interim opinion pending the research earmark below** — once we have literature-backed zones, these numbers change.
- **Cache (`cache:%`)** — suppressed (shown neutral) until the cache registers its first read in the session, so a fresh `cache:0%` never false-alarms. After warmup, colored by absolute level. In normal operation this value is effectively bimodal (~90%+ warm, ~0% right after a prefix invalidation), so the color mostly flags "you just burned the prefix." Proposed bands ≥80/50–80/<50 are provisional.
- **Rate limits** — `>75% amber / >90% red`, with the reset countdown always shown. Proposed; confirm.
- **Session timer** — red at ≥50m (carried from MVP; loosely tracks the ~1h subscription cache TTL).
- **Idle timer** — never colored; pure FYI.

### 4.4 Layout & format

- **Compact numbers by default** (`38k`), with an exact-numbers toggle for power users.
- **Adaptive line count:** the bar is not hard-coded to one or two lines. The number of rows follows from *what the user has enabled* (and available width) — a lean enabled set stays on one line; a fuller set wraps to a second row rather than truncating. (Claude Code truncates long single-line output on narrow terminals and shares the row's right edge with system notifications, so packing everything onto one forced line is a known failure mode.)

### 4.5 Configurability

**Opinionated, light config in v1.** The *documented, supported* surface is: show/hide each field, compact vs exact numbers, and the cache:% color toggle. Thresholds, colors, segment order, and zones are fixed opinions in the UI sense.

**But the architecture stores all settings in a hand-editable file (`~/.claude/cc-cream.json`) whose schema is designed for the fully-configurable future** — a power user can edit it to reorder segments, retune thresholds, or recolor, even though we ship no front-end for that and don't document it as a first-class feature. We design *for* full configurability; we just don't build the toggles UI yet.

---

## 5. Verified facts (grounding)

Confirmed against Anthropic docs on 2026-05-27:

- Every stdin field we rely on exists as documented: `cost.total_cost_usd`, the `context_window` / `current_usage` tree, `rate_limits.{five_hour,seven_day}.{used_percentage,resets_at}`, `effort.level`, `thinking.enabled`.
- `cost.total_cost_usd` is an **estimate, computed client-side, "may differ from your actual bill."**
- `used_percentage` is **input-only**: `input + cache_creation + cache_read` (excludes output). Our `cache:%` denominator matches this, which is correct.
- Cache reads are billed at **"roughly 10% of the standard input rate"** — the clean headline for the cache story (cleaner than the $1.50/$3.75 framing).
- `rate_limits` appears **only for Pro/Max subscribers after the first API response**, and each window can be independently absent → segments must hide gracefully.
- Subagents start cold (no cache hits on first call), warm across their own turns, and use the **5-minute TTL even on a subscription**; the parent cache is unaffected.
- `refreshInterval` minimum is **1 second**; needed so the timers tick while idle.

**Two findings that shaped this PRD:**
1. The dollar-savings story is notional for subscribers (usage is included in the plan) → cost is labeled notional; the sold value is limit-avoidance + speed.
2. **Cache TTL is not a fixed paid-vs-API split.** Subscription = 1h auto, **but drops to 5min when over-limit and drawing on usage credits**; API = 5min default, 1h only via `ENABLE_PROMPT_CACHING_1H=1`; `FORCE_PROMPT_CACHING_5M=1` overrides all. → Any time-based cache-warmth signal can't assume a TTL. (This is why idle is just an FYI clock in v1, not a warmth countdown.)

---

## 6. Open technical questions (next round)

These are deferred to the engineering/technical PRD round:

1. **Does a cache-read token count less toward the subscription rate limit than a fresh input token?** If yes, `cache:%` becomes directly actionable for limit-avoidance ("misses eat your 5h budget faster") and we lean harder on it. If all tokens count equally, cache:% is a speed/efficiency signal only.
2. **Does `cost.total_cost_usd` include subagent spend?** Still unresolved — the warm/cold experiments didn't answer it (the statusline used had no cost field). Re-test with cost on the bar.
3. **TTL detection** for any future warmth signal: deriving it from auth method + over-limit/credit state + env overrides (`ENABLE_PROMPT_CACHING_1H`, `FORCE_PROMPT_CACHING_5M`).
4. Adaptive-layout mechanics (width detection, wrap rules, segment priority when space is tight).
5. Marker/state files, refresh strategy, and `refreshInterval` default.
6. `cc-cream.json` schema design (must accommodate the deferred full-config future).

---

## 7. Backlog / v2+

Filed during this session; not in v1:

- **Burn-rate projection** for rate limits ("at this pace, 5h cap in ~38m") — the killer limit-avoidance feature; needs inter-invocation sampling/state.
- **Cache:% color-by-drop (deviation)** — flag red on a sharp drop = prefix invalidation; needs session state; pairs with burn-rate work.
- **API efficiency ratio** (`total_api_duration_ms / total_duration_ms`) — novel; off-thesis enough to wait.
- **Cache creation tokens** as a displayed field (the cost side of cache economics).
- **Session name + PR status** fields.
- **Subagents:** main-bar activity indicator and the full `subagentStatusLine` surface (per-subagent cache%/cost/duration).
- **True API tokenomics** — accurate per-token cost, the deferred secondary-audience feature.
- **Multi-model per-session breakdown.**
- **Full-configuration UX** (reorderable segments, themes, per-field toggle UI) on top of the already-flexible config file.

---

## 8. Research earmarks

- **Context-window-fullness vs model degradation literature.** Find academic work (e.g. "lost in the middle," long-context / context-rot studies) to replace the interim `<40/40–50/≥50` context zones with evidence-based thresholds. The 50%-red opinion is currently a rule-of-thumb; literature backing turns it into a defensible, on-brand stance. *(Ready to run this search on request.)*

---

## 9. Success criteria (v1, draft)

- The default bar renders the MVP fields + 5h/7d limits + notional cost, compact, adaptively wrapped, with no truncation on a standard-width terminal.
- Rate-limit segments color-warn and show reset countdowns; hide cleanly for API users.
- `ctx:%` and `cache:%` color per the zones above; `cache:%` never false-alarms on a cold start.
- All fields toggleable and all behavior overridable via `cc-cream.json`, even where undocumented.
- Installs as a native plugin from the community marketplace, GitHub, or npm.
