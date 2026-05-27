# cc-cream — Product Requirements v2

**Status:** Design decisions captured 2026-05-27. Not yet sliced into stories.
**Supersedes:** §11 v2+ backlog in `PRD.md`. Where this doc conflicts with `PRD.md`, this doc wins.
**Source:** Product review session 2026-05-27 — rate-limit display, peak hours, percentage direction, layout.

---

## What changed from v1 (read this first)

Four areas were redesigned:

1. **Rate-limit display** — format clarified, reset indicator added, peak hours segment added.
2. **Percentage direction** — made configurable (consumed vs. remaining); default stays consumed.
3. **Layout** — Layout A confirmed (2-row structure unchanged); `peak` joins Row 2.
4. **Config schema** — two new top-level keys (`percentage`); one new segment (`peak`).

---

## 1. Rate-limit display redesign

### 1.1 Format

Old: `5h:67%·43m` — ambiguous (is 43m elapsed? remaining? until blocked?)

New: `5h:67%·↺43m` — `↺` makes the countdown unambiguous: *this is when the budget resets and you get a fresh 100%*.

The `%` figure is consumed (default; see §3 for the configurable direction). The `↺` countdown is `resets_at − now`, formatted on the existing ladder: `≥1d → Nd`, `≥1h → HhMMm`, `<1h → MMm`.

### 1.2 What the 5-hour limit actually is

Important for anyone extending this code or explaining behavior to users:

- The 5-hour limit is a **token budget**, not a time budget. "5 hours" is how long the window lasts before resetting — not a guarantee of 5 hours of work.
- `used_percentage` is the fraction of that budget consumed. You can burn through it in 20 minutes on a heavy session, wait for `resets_at`, and start fresh.
- The **7d window** is a separate weekly ceiling that accumulates across all 5-hour resets — it is what prevents the "reset and burn again" strategy from being infinitely repeatable within a week.
- During **peak hours** (§2), each token costs more against the 5-hour budget via a server-side multiplier we cannot observe. `used_percentage` is therefore not linearly translatable to remaining usable tokens during peak. The `peak` indicator (§2) surfaces this condition; the burn-rate projection (§5, deferred) would make it quantitative.
- Anthropic does not expose the absolute token ceiling for either window. We work only with percentages.

### 1.3 Color thresholds (unchanged from v1)

Thresholds are always expressed in **consumed** terms internally, regardless of the `percentage` display setting (§3):

- `< 75%` consumed → neutral
- `75–90%` consumed → amber
- `≥ 90%` consumed → red

Config keys `amber` and `red` under `5h`/`7d` retain this meaning. When `percentage: "remaining"` is active, the display number flips but the threshold behavior does not — `amber: 75` still fires at 75% consumed, which displays as `5h:25%` in remaining mode.

---

## 2. Peak hours segment

### 2.1 Background

Anthropic adjusts 5-hour session limit drain rates during peak demand periods. Source: public X post by Anthropic employee Thariq (@trq212), 2026-03-27:

> "During weekdays between 5am–11am PT / 1pm–7pm GMT, you'll move through your 5-hour session limits faster than before. Your weekly limits remain unchanged."

This is **not documented in official Anthropic support articles** as of 2026-05-27. The times are stored in config (§4) so users can update them without a release if Anthropic changes the window.

### 2.2 Behavior

- Shows the word `peak` on Row 2 (after `7d`) during the configured window on weekdays.
- Hidden outside the window — no label, no placeholder.
- Color: **amber**. It is contextual information worth noticing, not an alarm.
- Weekday check (Mon–Fri) is **hardcoded behavior**, not configurable. The peak window is defined by Anthropic's policy; which days are weekdays is not a user preference.
- Timezone is **hardcoded to `America/Los_Angeles`** (Pacific Time is Anthropic's reference; this is a policy fact, not a user preference).
- Implementation uses `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'` — handles PST/PDT automatically, no manual offset arithmetic.

```js
function isPeak(config) {
  const { start = 5, end = 11 } = config?.segments?.peak ?? {};
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hour: 'numeric', hour12: false, weekday: 'short',
  }).formatToParts(new Date());
  const p = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return !['Sat', 'Sun'].includes(p.weekday) && +p.hour >= start && +p.hour < end;
}
```

- If `Intl` throws for any reason: hide the segment, never crash.

### 2.3 Config schema

```json
"peak": {
  "on": true,
  "row": 2,
  "order": 3,
  "start": 5,
  "end": 11
}
```

`start` and `end` are hours in PT (0–23, exclusive end). Fallback: `start → 5`, `end → 11` (per-field fallback rule from v1).

---

## 3. Percentage direction

### 3.1 New top-level config key

```json
"percentage": "consumed"
```

Two values: `"consumed"` (default) or `"remaining"`.

- **`consumed`** (default): all percentage displays count up. `ctx:19%` = 19% of context window used. `5h:67%` = 67% of budget gone.
- **`remaining`**: all percentage displays flip. `ctx:81%` = 81% of context window left. `5h:33%` = 33% of budget left.

This is a **display-only flip** (`100 − used_percentage`). Threshold config always uses consumed-basis values internally; the color behavior is identical in both modes. Only the shown number changes.

`idle` is unaffected — it is a duration, not a percentage.

### 3.2 Rationale

Consistency across segments was prioritized over per-segment naturalness. Both "19% consumed" and "81% remaining" are valid framings for context; `consumed` is the v1 default and requires no migration. Users who prefer the "how much do I have left?" framing set `"percentage": "remaining"` once and get consistent countdown behavior across all percentage segments.

### 3.3 README note (required)

The README must document that `amber`/`red` thresholds for all segments are always expressed in consumed terms, regardless of the `percentage` setting. Example: `"red": 90` on `5h` fires when 90% of the budget is consumed — displayed as `5h:10%` in remaining mode.

---

## 4. Config schema (v2 full)

Changes from v1 in **bold**:

```json
{
  "numbers": "compact",
  "ttl": "auto",
  "percentage": "consumed",
  "segments": {
    "model":    { "on": true,  "row": 1, "order": 1 },
    "ctx":      { "on": true,  "row": 1, "order": 2, "amber": 30, "orange": 40, "red": 50, "basis": "window", "ceiling": 200000, "display": "basis" },
    "cache":    { "on": true,  "row": 1, "order": 3 },
    "idle":     { "on": true,  "row": 1, "order": 4, "amber": 50, "red": 80 },
    "cost":     { "on": true,  "row": 1, "order": 5 },
    "5h":       { "on": true,  "row": 2, "order": 1, "amber": 75, "red": 90 },
    "7d":       { "on": true,  "row": 2, "order": 2, "amber": 75, "red": 90 },
    "peak":     { "on": true,  "row": 2, "order": 3, "start": 5, "end": 11 },
    "effort":   { "on": false, "row": 1, "order": 6 },
    "thinking": { "on": false, "row": 1, "order": 7 }
  }
}
```

New vs v1: `percentage` top-level key; `peak` segment.

---

## 5. Layout (confirmed)

**Layout A — refined current (2 rows).** Unchanged from v1 structure.

```
Opus 4.7 (1M context) | ctx:19% (38k)  cache:95%  idle:00:12 | ~$4.50
5h:67%·↺43m  7d:41%·↺4d  peak
```

Row 1 grouping (pipes): session identity | context health trio | economics.
Row 2: account budget windows + peak environment indicator.
API users (no `rate_limits`): Row 2 empty → single row, `peak` also hidden.

Width behavior: no change from v1. The main status line receives no width signal; layout adapts by enabled content, not terminal width. Narrow terminals truncate — this is CC platform behavior, not something we control.

---

## 6. Remaining v2+ backlog (carried from PRD.md §11, not yet designed)

These items were not discussed in the 2026-05-27 session and carry forward as-is:

- **Cache drop-detection red** — flag a sharp last-turn drop in `cache%` as prefix burn. Requires per-session state keyed by `session_id`.
- **Burn-rate projection** — "at this pace, 5h cap in ~12m." Requires inter-invocation sampling. Also the mechanism that would make the peak multiplier effect quantitatively visible.
- **Subagents** — `subagentStatusLine` surface (the one surface a plugin can ship; width-aware via `columns`) and a main-bar subagent activity indicator. Blocked on absence of cost/cache% in the `tasks` array.
- **API efficiency ratio** — `total_api_duration_ms / total_duration_ms`.
- **Additional stdin fields** — `session_name`, `pr`, `worktree`, `cache_creation_input_tokens` as a displayed metric.
- **True API tokenomics** — accurate per-token cost, not the client-side `~` estimate.
- **Multi-model per-session breakdown.**
- **npm bin + marketplace plugin** — distribution channels deferred from v1 §14.1. Engine single-file/built-ins constraint makes these cheap to add; the consent installer already ships.
- **Finer layout flexibility** — row regrouping, per-field reorder UX.
- **Full configuration UX** — toggle UI, themes.
- **Occupancy vs. session/daily burn** — v1 `ctx%` is current-window occupancy; whether to surface cumulative daily burn toward quotas is a separate design conversation (no raw cumulative-token field in stdin; would lean on cost + rate-limit windows).
