# Configuration Reference — cc-cream

Configuration lives at `~/.claude/cc-cream.json`. You can edit it by hand or ask Claude to make changes. It is strict JSON with no comments. **Every field falls back to its built-in default if missing or malformed** — a typo degrades one value rather than breaking the bar; a whole-file parse error falls back to all defaults.

Run the doctor after editing by hand to catch typos and out-of-domain values:
```bash
cc-cream-setup --check-config
```

## Default config

```json
{
  "numbers": "compact",
  "ttl": "auto",
  "percentage": "consumed",
  "segments": {
    "ctx":          { "on": true,  "row": 1, "order": 2, "amber": 30, "orange": 40, "red": 50, "basis": "window", "ceiling": 200000, "display": "basis" },
    "cache":        { "on": true,  "row": 1, "order": 3, "drop": 20, "drop_recover": 80 },
    "write":        { "on": false, "row": 1, "order": 3.5 },
    "ttl":          { "on": true,  "row": 1, "order": 4, "amber": 50, "red": 80 },
    "cost":         { "on": true,  "row": 1, "order": 5 },
    "effort":       { "on": false, "row": 1, "order": 6 },
    "thinking":     { "on": false, "row": 1, "order": 7 },
    "api_ratio":    { "on": false, "row": 1, "order": 8 },
    "5h":           { "on": true,  "row": 2, "order": 1, "amber": 75, "red": 90 },
    "burn":         { "on": true,  "row": 2, "order": 1.5 },
    "7d":           { "on": true,  "row": 2, "order": 2, "amber": 75, "red": 90 },
    "peak":         { "on": true,  "row": 2, "order": 3, "start": 5, "end": 11, "lead": 60 },
    "model":        { "on": true,  "row": 3, "order": 0.5 },
    "session_name": { "on": false, "row": 3, "order": 1 }
  }
}
```

## Global keys

- `numbers`: `compact` (e.g. `38k`) or `exact` (`38000`) for token magnitudes.
- `ttl`: cache time-to-live used to color the `ttl` segment — `auto` (recommended), `60`, or `5` minutes. `auto` infers from rate-limit data when available.
- `percentage`: `consumed` (default) counts up — `ctx:19%` means 19% of the window is used, `5h:67%` means 67% of the 5h budget is gone. `remaining` flips the budget/occupancy segments to count down (`ctx:81%`, `5h:33%`). Only `ctx`, `5h`, and `7d` flip; `cache%` (a hit-rate, not a budget) and `ttl` (a countdown) are unaffected. Thresholds are always expressed in consumed terms regardless of this setting.

## Per-segment keys

Every segment accepts:
- `on` (boolean) — whether to show the segment
- `row` (1, 2, or 3) — which row to place it on
- `order` (any number) — lower = further left within the row

Colored segments additionally accept threshold keys. Thresholds mark the **lower bound** where that color begins.

## Segment catalog

| Segment | Default | Example | Meaning | Color |
|---|---|---|---|---|
| `ctx` | on, row 1 | `ctx:19% [38k]` | context-window occupancy + input-token magnitude | `<30` green · `30–40` amber · `40–50` orange · `≥50` red |
| `cache` | on, row 1 | `cache:95%` | last-turn cache hit rate (reads / total tokens) | neutral; **red** on a sharp drop (see below) |
| `write` | **off**, row 1 | `write:4%` | last-turn cache creation rate (new writes / total tokens) | neutral |
| `ttl` | on, row 1 | `ttl:00:52` | time remaining before cache expires (counts down to 00:00) | `<50%` green · `50–80%` amber · `≥80%` red |
| `cost` | on, row 1 | `~$4.50` | session cost incl. subagents; `~` = CC's estimate | neutral; hidden when zero |
| `effort` | **off**, row 1 | `effort:high` | reasoning effort level (requires CC ≥ 2.1.145) | neutral |
| `thinking` | **off**, row 1 | `think:on` | thinking mode indicator (requires CC ≥ 2.1.145) | neutral |
| `api_ratio` | **off**, row 1 | `∿ api:74%` | fraction of wall time spent on API calls | neutral |
| `5h` | on, row 2 | `5h:23% ↺ 2h14m` | 5-hour rate-limit window + reset countdown | `≥75` amber · `≥90` red |
| `burn` | on, row 2 | `~38m` | estimated minutes until 5h cap at current pace | neutral; hidden when ETA > 5h or no prior sample |
| `7d` | on, row 2 | `7d:41% ↺ 4d` | weekly rate-limit window + reset countdown | same as 5h |
| `peak` | on, row 2 | `peak until 11:00` · `peak in 47m` | weekday Pacific-time window where 5h drains faster | amber; hidden outside window |
| `model` | on, row 3 | `Sonnet 4.6` | current model name | none |
| `session_name` | **off**, row 3 | `My project session` | conversation name from CC | none |

Any segment hides cleanly when its source field is absent — API users have no `rate_limits`; `current_usage` is null right after `/compact`; etc.

Row 2 is hidden entirely for API users (no `rate_limits` in stdin). Row 3 suppresses itself when all its segments are hidden.

## Row 1 layout

Row 1 has two zones separated by ` | `:

```
[ctx · cache · write · ttl · effort · thinking · api_ratio] | [cost]
```

Segments within zone 1 are also separated by ` | `. Segments moved off their default row via config must land in a zone to appear on row 1.

## `ctx` — specific keys

- `basis`: `window` (default) colors based on `used_percentage` of the real context window. `ceiling` colors based on `total_input_tokens / ceiling`, so the warning fires at the same absolute token count on any window size. On a 1M-context model the window basis stays green well past where quality degrades — set `ceiling` if you want an early warning that doesn't scale with the window.
- `ceiling`: token count the `ceiling` basis measures against. Default `200000`.
- `display`: with `basis: "ceiling"`, `basis` (default) shows the % toward the ceiling so number and color agree; `window` pins it to CC's window figure but still colors by the ceiling. No effect under `basis: "window"`.

Thresholds — default: `amber: 30`, `orange: 40`, `red: 50` (percent consumed).

## `cache` — drop detection

The `cache` segment stays neutral while the hit rate is healthy, but turns **red** when it falls sharply from one turn to the next — a cue that the prompt cache was just invalidated. Relies on per-session state, so it only fires when `session_id` is present in stdin.

- `drop`: percentage-point fall from the previous turn that trips red. Default `20` (95% → 74% trips; 95% → 80% does not).
- `drop_recover`: once tripped, the segment stays red until the hit rate climbs back to at least this value. Default `80`.

## `ttl` — thresholds

Default: `amber: 50`, `red: 80` (percent of the resolved TTL consumed).

## `5h` / `7d` — thresholds

Default: `amber: 75`, `red: 90` (absolute `used_percentage`).

## `peak` — specific keys

- `start` / `end`: hours in Pacific time (0–23, exclusive end) bounding Anthropic's faster-drain window. Defaults `5`–`11`. Weekday-only (Mon–Fri) and the `America/Los_Angeles` timezone are hardcoded policy facts, not config.
- `lead`: minutes before `start` that the approaching countdown appears. Default `60`. Inside the window the segment reads `peak until HH:MM` (the window's close in **your local timezone**); in the `lead` minutes before it opens, it counts down `peak in Nm`.
