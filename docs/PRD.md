# cc-cream — Product Requirements (v2, dev/tech-refined)

**Product:** cc-cream — a Claude Code status-line tool.
**Tagline:** C.R.E.A.M. — Cache Rules Everything Around Me.
**Status:** v2, 2026-05-27. Architecture pass complete: facts re-verified against current Claude Code docs (statusline, plugins-reference, prompt-caching; ~2026-05-26) **and against a live Claude Code session** (§12), engineering forks resolved, defaults pinned, threshold/config schema finalized. Ready to slice into user stories — not yet written. **This document is the single source of truth; the session that produced it is not recoverable, so all decisions and their rationale are captured here.**
**Sources:** Product Q&A + this architecture session. Background MVP and exploration notes live in `archive/` (`statusline-command.sh`, `EXPLORATION.md`, `HANDOFF.md`).

> **What changed from v1 (read this first).** Five v1 claims were wrong or load-bearing-and-unverified; all are corrected below:
> 1. **A plugin cannot turn on the main status line.** The plugin manifest has no `statusLine` field; a plugin's bundled `settings.json` supports only `agent` and `subagentStatusLine`. The main `statusLine` must be set in the *user's* settings.json. → cc-cream is a config helper that writes that line with consent; "plugin" is a distribution wrapper, not auto-activation. (§1, §7)
> 2. **The main status line receives no terminal width** (only `subagentStatusLine` gets `columns`). → Layout adapts by *enabled content*, never by terminal width. (§5)
> 3. **`context_window.*` is current-context occupancy, not cumulative session burn** (bug-fixed in CC v2.1.132, 2026-05-06). `total`/`in`/`out`/`ctx:%` all describe the current-context snapshot, not cumulative burn. → trimmed to `ctx:%` plus one input-only magnitude. (§4)
> 4. **`current_usage` field names/nesting were wrong.** Correct: `context_window.current_usage.{cache_read_input_tokens, cache_creation_input_tokens, input_tokens}`. (§4, §10)
> 5. **Cache TTL is a sliding window keyed to inactivity, not session length.** → the cache-warmth signal is the idle gap, not a session timer. (§4, §9)

---

## 1. What it is

Claude Code natively renders a status line from a shell command you configure in `settings.json`. **cc-cream *is* that command** — a single-file program that reads the JSON Claude Code pipes to it on stdin and prints a formatted, colored, up-to-two-row bar — **plus a consent-based installer** that writes the one `statusLine` line into the user's settings.json. The model never sees the output, so it costs zero tokens.

cc-cream helps a user **manage a session to avoid rate limits, keep the cache warm, and keep context from filling to the point the model degrades**, with cache economics as the organizing story.

It does **not** hook the status line at the protocol level and **cannot auto-activate** on install — the platform only lets plugins ship `subagentStatusLine`, not the main bar. The marketplace "plugin" is a discovery/distribution wrapper around the same engine (§7).

## 2. Who it's for (positioning)

**Primary: Claude Pro/Max subscribers.** Usage is included in their plan, so a warm cache saves them *no dollars* — it buys **speed** and **rate-limit headroom** (the 5h and weekly windows are token-counted). Their payoff: *don't get throttled, don't reprocess context you could have kept cached, and don't let the window fill to where quality drops.*

**Secondary: API-key / pay-per-token users.** Served where cheap (same fields). For them the cost figure is closer to real spend; for subscribers it's directional "API-equivalent value."

**Explicitly deferred:** accurate per-token API tokenomics (a later feature; v1 is not a billing meter).

### Thesis caveat (verified)
On a subscription, usage is included in the plan, so the literal cash-savings framing is notional for the primary audience. We keep the cache-economics brand and glance; the sold value is **limit-avoidance and speed, not dollars.**

**Cost stays a default segment (decided).** The live probe confirmed `total_cost_usd` populates for subscribers *and* includes sub-agent spend (§12), so it's a real, complete number — kept on by default with the `~` notional framing for subscribers (API-equivalent value), not demoted despite being notional for the primary audience.

## 3. Goals / non-goals

**Goals (v1)**
- A glanceable bar covering: model, context fullness, last-turn cache hit-rate, cache-warmth (idle-vs-TTL), notional cost, and the 5h/weekly rate-limit windows.
- Be an *early-warning system* for rate limits and cache expiry, not a passive readout.
- Opinionated defaults; fully retunable via a single hand-edited config file.
- Cross-platform (macOS, Windows, Linux), CLI-native, minimal dependencies.

**Non-goals (v1)**
- Accurate per-token API cost accounting.
- Any subagent UI (`subagentStatusLine` or main-bar subagent indicator) — deferred (§11).
- **Width-responsive layout** — the main status line gets no width signal; layout adapts by enabled content only (§5).
- A configuration front-end / TUI / theme engine (the file is the only interface).
- Auto-activation on install (platform doesn't allow it; install is a consent-based settings edit).

---

## 4. What we measure and show

Each segment lives in a different **time-base**; conflating them is a category error, so the table names it explicitly. Color logic lists the **v1 default** (all retunable via config, §6).

### 4.1 Default segments (on out of the box)

| Segment | Shown as | Source field(s) | Time-base | Color logic (default) |
|---|---|---|---|---|
| Model | `Opus 4.7 (1M context)` | `model.display_name` | static | none |
| Context | `ctx:19% (38k)` | `context_window.used_percentage`; compact magnitude = `total_input_tokens` (input-only, to match `used_percentage`) | current-context snapshot | `<25 green · 25–40 amber · ≥40 red` (the "50% ceiling" model — §4.4; interim, research earmark §11) |
| Cache | `cache:95%` | `context_window.current_usage.cache_read_input_tokens / (cache_read_input_tokens + cache_creation_input_tokens + input_tokens)` | **last turn** (most recent API response) | **neutral in v1** (no color; drop-detection red is v2) |
| Idle / cache-warmth | `idle:00:00` | `now − mtime(transcript_path)`, vs TTL from §9 | derived (time since last activity) | `<50% TTL green · 50–80% amber · ≥80% red`; stays red past expiry |
| Cost | `~$4.50` | `cost.total_cost_usd` | cumulative session (incl. subagent spend — verified live) | neutral; `~` = estimate; **auto-hidden if zero/absent** |
| 5-hour limit | `5h:23%·2h14m` | `rate_limits.five_hour.{used_percentage, resets_at}` | rolling window | `<75 neutral · 75–90 amber · ≥90 red`; countdown always shown |
| Weekly limit | `7d:41%·4d` | `rate_limits.seven_day.{used_percentage, resets_at}` | rolling window | same as 5h |

`total`/`in`/`out` from the v1 MVP are **dropped**: post-CC-v2.1.132 they all describe current-context occupancy, which `ctx:%` already shows. We keep `ctx:%` (model-independent — verified live: `used_percentage` ≈ input-tokens / context-window, against a 1M window) plus one magnitude. **`used_percentage` is input-only** (`input + cache_creation + cache_read`, excludes output), so the magnitude uses `total_input_tokens` on the same basis — otherwise the percentage and the parenthetical disagree on output-heavy turns.

### 4.2 Optional segments (shipped, off by default)

| Segment | Source | Notes |
|---|---|---|
| Effort | `effort.level` (low…max) | absent when model lacks effort; relevant to burn + cache (an effort change invalidates the prefix) |
| Thinking | `thinking.enabled` | boolean indicator |

Both ship as config segments defaulting `on:false` (near-zero cost given the data-driven config). They sit on Row 1 and can push it past 80 cols, which is why they're off by default. Everything else in the stdin schema is deferred (§11).

### 4.3 Default bar — rendered examples

Subscriber (rate_limits present → two rows):
```
Opus 4.7 (1M context) | ctx:19% (38k) cache:95% idle:00:00 | ~$4.50
5h:23%·2h14m  7d:41%·4d
```
API user (no rate_limits → Row 2 has no content → one row, cost reads near-actual):
```
Opus 4.7 (1M context) | ctx:19% (38k) cache:95% idle:00:00 | ~$4.50
```
Stepped away ~52 min on a 60m TTL (idle red — 87% of TTL; next turn rebuilds the prefix):
```
Opus 4.7 (1M context) | ctx:19% (38k) cache:95% idle:00:52 | ~$4.50
```

### 4.4 Color & threshold philosophy
Opinionated defaults, all overridable per-field via config:
- **Context** — we treat **50% window occupancy as the practical ceiling** (quality degrades well before the window is literally full), then apply the idle timer's band shape *within* that ceiling: green <50% of ceiling, amber 50–80%, red ≥80%. In raw `used_percentage` that is **`<25 green · 25–40 amber · ≥40 red`** — red begins at 40% of the real window. Deliberately aggressive; interim pending the research earmark (§11), which would move the ceiling, not the mechanism.
- **Cache** — neutral in v1. The bimodal last-turn value can't distinguish a cold-start write from a mid-session prefix-burn without session state; the *preventive* cache signal lives in the idle timer instead. Drop-detection red is a v2 item.
- **Idle / cache-warmth** — early-warning bias: amber at 50% of TTL, red at 80% (≈48m on a 60m TTL) so red means "act now," not "already lost." Stays red past expiry.
- **Rate limits** — `≥75 amber / ≥90 red`, reset countdown always shown. Countdown is `resets_at − now` on a format ladder: `≥1d → Nd` (`4d`), `≥1h → HhMMm` (`2h14m`), `<1h → MMm` (`43m`).

### 4.5 Idle-segment formatting
Count-up stopwatch, zero-padded **`hh:mm`** of elapsed time since last activity (`idle:00:00`, `idle:00:52`, `idle:01:07`; hours grow past two digits if needed). No seconds — refresh is 60s (§8), so sub-minute precision would only be stale. Green `idle:00:00` during active work reads as a "cache warm" health light.

---

## 5. Layout & format

- **Two logical rows, grouped by time-base.** Row 1 = this-session (model · context · cache · idle · cost). Row 2 = account windows (5h · 7d). Each row is one emitted line.
- **Adaptive line count by *content*, not width.** Row 2 renders only if it has content, so API users (no `rate_limits`) get a single row automatically. The main status line receives **no terminal-width signal**, so we never reflow to the terminal; the default enabled set is tuned to fit the width budget.
- **Width budget: 80 columns** (the common narrow default). The default Row 1 is ≈67 cols for a `model.display_name` like `Opus 4.7 (1M context)` — the name is variable-length and outside our control, so an unusually long one can overflow. If a user toggles optional segments past 80, the row soft-wraps (a documented consequence of their choice) or they raise the `width` config value. We do not hard-split Row 1 in v1; finer regrouping is a v2 flexibility item.
- **Compact numbers by default** (`38k`), exact-numbers a config option.
- Output uses ANSI color codes; the bar shares its row's right edge with Claude Code system notifications, which can truncate it on narrow terminals (platform behavior we design around, not against).

---

## 6. Configuration

**One file, `~/.claude/cc-cream.json`, fully data-driven.** It is the single source of truth and the only interface — edited by hand in a text editor, or by asking Claude to edit it. No UI, no TUI, no migration framework.

The engine reads every display decision from this file: per-segment `on`/`row`/`order`, number format, color thresholds, and width. **Every field falls back to a built-in default if missing or malformed**, so a typo degrades one value rather than crashing the bar. This makes "power users can retune anything" literally true at near-zero extra code (the cost of configurability is in UIs, not in reading a number from JSON).

Schema (strict JSON — no comments; threshold keys are final):
```json
{
  "width": 80,
  "numbers": "compact",
  "ttl": "auto",
  "segments": {
    "model":    { "on": true,  "row": 1, "order": 1 },
    "ctx":      { "on": true,  "row": 1, "order": 2, "amber": 25, "red": 40 },
    "cache":    { "on": true,  "row": 1, "order": 3 },
    "idle":     { "on": true,  "row": 1, "order": 4, "amber": 50, "red": 80 },
    "cost":     { "on": true,  "row": 1, "order": 5 },
    "5h":       { "on": true,  "row": 2, "order": 1, "amber": 75, "red": 90 },
    "7d":       { "on": true,  "row": 2, "order": 2, "amber": 75, "red": 90 },
    "effort":   { "on": false, "row": 1, "order": 6 },
    "thinking": { "on": false, "row": 1, "order": 7 }
  }
}
```

**One threshold convention for every colored segment:** each color names the **lower bound where it begins**; the color function evaluates `red` first, then `amber`, else neutral/green. Bounds are absolute `used_percentage` for `ctx`/`5h`/`7d`, and **percent of the resolved TTL** for `idle` (§9). **Parsing rule:** strict JSON via the runtime's native parser (no comments); a missing/malformed *single* field falls back to its own default, and a whole-file parse failure (e.g. a hand-edit trailing comma) falls back to **all** defaults. Global-key fallbacks: `width`→80, `numbers`→`compact`, `ttl`→`auto`. Duplicate `(row, order)` ties break by a fixed canonical segment order; `row` accepts only `{1,2}`.

---

## 7. Runtime & distribution

- **Engine: a single-file Node program using only built-ins** (native JSON parse — no `jq`). Claude Code itself is a Node app, so Node is effectively guaranteed present; this is the most CLI-native, lowest-friction cross-platform choice and makes npm distribution native. (~60 ms cold start; the binding latency constraint is the **per-message event path**, not the 60s refresh — see §8 — so the engine must start *and* finish well inside it.) Rejected: bash+jq (not Windows-native, needs jq); compiled binary (per-OS/arch release machinery, opaque GitHub artifact — overkill for v1).
- **One engine, three thin packagings:** marketplace plugin wrapper (discovery) · npm package with a `bin` · raw `.js` on GitHub.
- **Install = a consent-based settings.json edit**, shared by all three channels via one installer module (the npm/raw channels run it directly; the plugin channel ships it as a `/cc-cream:install` command/skill, since a plugin manifest cannot set the main `statusLine`). It writes `"statusLine": { "type": "command", "command": "<path>", "refreshInterval": 60 }` after showing the change. The installer **must detect an existing `statusLine`** (many users already run one — including this repo's own MVP) and confirm before replacing it, **preserve any `padding`** the user set (it shrinks the 80-col budget), and surface that Claude Code must be **trusted and possibly restarted** for the bar to appear. No channel can auto-activate the main bar.
- **Minimum Claude Code version: 2.1.132** (2026-05-06) for the default set (it needs `context_window.current_usage` for the cache figure; `rate_limits` 2.1.80 and `used_percentage` 2.1.6 are older). Optional `effort`/`thinking` *additionally* require **2.1.145** and stay hidden below it. We target current CC and don't maintain back-compat below the floor; every field is null-checked — and may be null/absent even on the newest version (`current_usage` is null right after `/compact`; `rate_limits` absent for API users) — so a missing value degrades to a hidden/neutral segment, never a broken bar.

## 8. State & refresh

- **The v1 feature set is essentially stateless** — no session-keyed files, no concurrency or cleanup problem.
  - Idle / cache-warmth = `now − mtime(transcript_path)` (the transcript is appended every turn, so its mtime *is* last activity; it correctly sits at ~0 during a long agent run and climbs only when you step away). One `stat()`, no transcript parsing, no marker files. If `transcript_path` is absent or `stat` fails, **hide the idle segment** rather than show `idle:0m` (which would be a false "cache warm" signal).
  - All other segments read straight off stdin. Rate-limit windows are computed by Claude Code across sessions and handed to us in `rate_limits` — we keep no multi-session bookkeeping.
  - **Verified live:** multiple Claude Code sessions run the *same* global statusline command concurrently (the probe caught four sessions interleaving in one un-keyed file). v1 needs no shared state so this is harmless — but any future state (v2 drop-detection, burn-rate) **must** be keyed by `session_id`.
- **`refreshInterval: 60`** (installer-set). Needed only so the idle timer advances while you're present-but-idle; active work redraws on **events** — CC re-runs the statusline after every assistant message, **300ms-debounced, cancelling any in-flight run**, so the engine must finish inside ~300ms or its output is dropped. 60s suits a TTL warning that matters at the ~minute scale.
  - *Considered and rejected (infeasible):* an adaptive "speed up to 1s in the final 10 minutes." `refreshInterval` is a single static setting; the command has no return channel to change its own cadence, CC reads the setting once, and a background daemon can't drive CC's render. The only lever is one fixed interval; 1s-always was rejected as wasteful, and 60s already renders a clear per-minute red countdown in the final stretch.

## 9. TTL inference (idle coloring)

The idle segment colors against an inferred TTL. The engine inherits Claude Code's environment, so it can read the same cache overrides CC obeys. Resolution order:
```
if FORCE_PROMPT_CACHING_5M   -> 5m
elif rate_limits present:                 # subscriber
        over a window cap?   -> 5m  else -> 60m
else:                                      # API user (no rate_limits)
        ENABLE_PROMPT_CACHING_1H ? 60m : 5m
```
The "over a window cap" test is **best-effort**: stdin can't observe "drawing on usage credits," so we approximate it as *either window `used_percentage ≥ 100` → assume 5m*. `ttl` in config overrides (`auto` | `60` | `5`), but `auto` is safer than a pin: a stale `ttl: 60` would *under-warn* an over-limit subscriber whose real TTL dropped to 5m — the one direction an early-warning tool must not get wrong.

---

## 10. Verified facts (grounding)

Confirmed against current Claude Code / Anthropic docs (2026-05-27):
- **Cache TTL is a sliding window refreshed on every hit** — *"Each request that hits the cache resets the timer, so the cache stays warm as long as you keep working."* Only the **idle gap** matters; total session length is irrelevant. TTL expiry (time) and context compaction (size) are **separate** mechanisms.
- **TTL values:** subscription defaults to 1h, dropping to 5m when over-limit/drawing on usage credits; API/Bedrock/Vertex defaults to 5m, 1h via `ENABLE_PROMPT_CACHING_1H=1`; `FORCE_PROMPT_CACHING_5M=1` overrides all.
- **Cache reads bill at roughly 10% of the standard input rate** (the clean cache headline).
- **`cost.total_cost_usd` is a client-side estimate, "may differ from your actual bill."**
- **`context_window.*` reflects current context usage, not cumulative session totals** (CC v2.1.132 bug-fix). There is **no cumulative raw-token field** in stdin; cumulative signals are cost (dollars) and rate-limit windows (%).
- **`rate_limits` appears only for Pro/Max subscribers after the first API response**, and each window can be independently absent → segments hide gracefully.
- **The main `statusLine` stdin has no width/`columns` field** (only `subagentStatusLine` does). Multiple lines = multiple emitted prints; ANSI colors supported.
- **Plugins cannot configure the main `statusLine`** — manifest has no such field; bundled `settings.json` supports only `agent` and `subagentStatusLine`.
- `refreshInterval` minimum is 1s; set in the `statusLine` settings object.

**Confirmed (was unverified in v1):** `used_percentage` is **input-only** — `input + cache_creation + cache_read`, excluding output — both documented and consistent with the live probe (§12). So the `ctx:%` magnitude uses `total_input_tokens` on the same basis (§4.1) to keep the percentage and the parenthetical in agreement.

---

## 11. Parked, earmarks, and v2+ backlog

**Parked for a dedicated session**
- **Occupancy vs session/daily burn.** v1's context segment is *current-window occupancy* (the right signal for context-rot; it correctly drops on `/compact`). Whether/how to also surface cumulative daily burn toward quotas is a separate design conversation — there is no raw cumulative-token field, so this would lean on cost + rate-limit windows.

**Research earmark**
- **Context-fullness vs model-degradation literature** ("lost in the middle," context-rot studies) to replace the interim `<25/25–40/≥40` zones (and the underlying "50% occupancy = ceiling" assumption) with evidence-based thresholds. (Ready to run on request.)

**v2+ backlog**
- **Cache:% drop-detection red** (flag a sharp last-turn drop = prefix burn); needs the per-session "seen-read" flag we deliberately omitted to stay stateless.
- **Burn-rate projection** for rate limits ("at this pace, 5h cap in ~38m"); needs inter-invocation sampling.
- **Subagents:** `subagentStatusLine` (the one surface a plugin *can* ship; it also receives `columns`, making it the only width-aware surface) and a main-bar activity indicator. Deferred because per-subagent cache%/cost are **not** provided — the `tasks` array carries `tokenCount`/`tokenSamples`/`startTime` (among others) but no cost or cache%, so the v2 vision needs token/pricing math, exactly the over-engineering to avoid now.
- **API efficiency ratio** (`total_api_duration_ms / total_duration_ms`).
- **Cache-creation tokens** as a displayed field.
- **Session name + PR status** fields (`session_name`, `pr`, `worktree` exist in stdin).
- **True API tokenomics** (accurate per-token cost).
- **Multi-model per-session breakdown.**
- **Finer layout flexibility** (regroup/split rows, per-field reorder UX) atop the already-flexible config.
- **Full-configuration UX** (toggle UI, themes).

## 12. Resolved by live probe (2026-05-27) + remaining
Verified against a live subscription session (`claude-opus-4-7[1m]`, `service_tier: standard`):
1. **`cost.total_cost_usd` IS populated on subscription** — non-zero and rising (`$5.58 → $7.37` observed). A brand-new session reads `0` until its first API turn (handled by auto-hide). Subscribers do see the figure.
2. **`cost.total_cost_usd` INCLUDES subagent spend** — the parent session's cost stepped up across a sub-agent's tool-use turns while the main thread was idle. (Sub-agent *turns* live in separate transcripts, so the total is complete but not breakdown-reconstructable from the parent transcript.)
3. **`used_percentage` is a clean input-only ratio vs the real window** (live: 162k→16%, 48k→5%, 30k→3% on a 1M window). **Remaining:** confirm the denominator tracks a 200k window too (only 1M was live-tested).

Also observed live: `ephemeral_1h_input_tokens` populated with `ephemeral_5m` at 0 → the 1-hour TTL is genuinely in force for this subscriber, validating §9's subscriber→60m branch.

## 13. Success criteria (v1)
- Default bar renders Row 1 (`model · ctx:% (total) · cache · idle · cost`) within 80 cols, plus Row 2 (`5h · 7d`) for subscribers; API users get one row automatically.
- Rate-limit segments color-warn and show reset countdowns; hide cleanly when absent.
- `ctx:%` colors per the zones; idle colors against the inferred TTL and never warns when actively working (idle ≈ 0 during agent runs).
- Cost shows `~$x` for everyone and auto-hides when CC reports zero/absent.
- Every display decision is driven by `cc-cream.json` with per-field fallback; a malformed field degrades one value, never the bar.
- Runs as a single-file Node program on macOS/Windows/Linux with no external dependencies; installs via marketplace, npm, or raw GitHub by writing one consented line into settings.json.
- Installer is idempotent, detects and confirms before replacing an existing `statusLine`, preserves any user `padding`, and surfaces the trust/restart requirement.

## 14. Backlog-prep decisions (2026-05-27)
Confirmed while slicing this PRD into a backlog. Where they conflict with earlier prose, **these supersede it.**

1. **Distribution scope — raw `.js` on GitHub is the only v1 channel.** npm `bin` packaging and the marketplace plugin wrapper move to the v2+ backlog (§11). The single-file/built-ins engine constraint (§7) is unchanged — it's precisely what makes those deferred channels cheap to add later. The consent-based installer (§7) still ships in v1; it simply targets the raw-`.js` path.
2. **`width` is dropped from the v1 config schema.** The main status line receives no width signal and the engine never reflows (§5), so the field had no runtime effect. The **80-column design target stays** (the default enabled set is tuned to fit it); only the config knob is removed. Global-key fallbacks (§6) reduce to `numbers→compact`, `ttl→auto`. Width-aware layout is revisited under the v2 layout-flexibility item (§11). Supersedes the `width` references in §5 and §6.
3. **BDD fixtures — golden capture (subscriber) + synthetic edges.** Scenarios run against stdin **captured live from a subscription Claude Code session** as golden fixtures, supplemented by **synthetic fixtures** for edge cases: null/absent fields, `current_usage:null` right after `/compact`, missing `rate_limits` (API-shaped), and malformed/empty stdin. **API-user stdin sampling is deferred to its own later ticket** — not a v1 priority. This also pins the "degrade, never crash" rule to stdin, not just config (closes the §6-only gap).
4. **"Verify stdin fields" is the first backlog story, gating ctx-magnitude work.** It confirms real field names/shapes against a live session — notably `total_input_tokens` (the §4.1 magnitude source, absent from the §10/§12 verified list) and the open 200k-window denominator question (§12). Nothing that depends on an unverified field name is built until this story closes.
