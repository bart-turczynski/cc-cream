# cc-cream

**C.R.E.A.M. — Cache Rules Everything Around Me.** A small status-line tool
for [Claude Code](https://claude.com/claude-code) that turns the JSON Claude Code
pipes to its status line into a glanceable, colored 3-row bar:

```
ctx:48% [97k] | cache:100% | ttl:01:00 | ~$3.10
5h:11% ↺ 2h20m | 7d:52% ↺ Sat 21:00 | peak
Sonnet 4.6 | My project session
```

It helps you **avoid rate limits, keep the cache warm, and keep context from
filling to where the model degrades** — with cache economics as the organizing
story. The model never sees the output, so it **costs zero tokens**.

- **Row 1** — this session's stats: `ctx · cache · ttl · cost`
- **Row 2** — account windows: `5h · 7d · burn projection · peak` (subscribers only; API users get one row)
- **Row 3** — identity: `model · session name`

## Requirements

- **Node.js** (you already have it — Claude Code is a Node app). No other runtime,
  no `jq`, no dependencies.
- **Claude Code ≥ 2.1.132** (2026-05-06). The cache figure needs
  `context_window.current_usage`, which landed in that release. The optional
  `effort`/`thinking` segments additionally need 2.1.145 and stay hidden below it.

## Install

**Via npm / npx:**
```bash
npx cc-cream          # run once to try it
npm install -g cc-cream   # install globally
```
Then run the consent installer to wire it into Claude Code:
```bash
node $(npm root -g)/cc-cream/src/install.js
```

**Via raw JavaScript from GitHub:**
1. **Download** the runtime files to your Claude config directory:
   ```bash
   mkdir -p ~/.claude/cc-cream-src
   curl -fsSL https://github.com/<owner>/cc-cream/archive/refs/heads/main.tar.gz |
     tar -xz --strip-components=2 -C ~/.claude/cc-cream-src cc-cream-main/src
   ```
2. **Run the consent installer:**
   ```bash
   mkdir -p ~/.claude/cc-cream
   curl -fsSL https://raw.githubusercontent.com/<owner>/cc-cream/main/src/install.js \
     -o ~/.claude/cc-cream/install.js
   node ~/.claude/cc-cream/install.js ~/.claude/cc-cream-src/cc-cream.js
   ```

The installer detects an existing `statusLine` and **asks before replacing it**,
**preserves any `padding`** you set, and is **idempotent** (re-running changes
nothing). Claude Code must be **trusted** for the folder, and you may need to
**restart** it for the bar to appear.

The installer writes:

```json
"statusLine": {
  "type": "command",
  "command": "node ~/.claude/cc-cream/cc-cream.js",
  "refreshInterval": 60
}
```

## Configuration

Every display decision is read from `~/.claude/cc-cream.json` — the only interface.
Edit it by hand (or ask Claude to). It is strict JSON (no comments). **Every field
falls back to a built-in default if missing or malformed**, so a typo degrades one
value rather than breaking the bar; a whole-file parse error falls back to all
defaults.

```json
{
  "numbers": "compact",
  "ttl": "auto",
  "percentage": "consumed",
  "segments": {
    "ctx":          { "on": true,  "row": 1, "order": 2, "amber": 30, "orange": 40, "red": 50, "basis": "window", "ceiling": 200000, "display": "basis" },
    "cache":        { "on": true,  "row": 1, "order": 3 },
    "write":        { "on": false, "row": 1, "order": 3.5 },
    "ttl":          { "on": true,  "row": 1, "order": 4, "amber": 50, "red": 80 },
    "cost":         { "on": true,  "row": 1, "order": 5 },
    "effort":       { "on": false, "row": 1, "order": 6 },
    "thinking":     { "on": false, "row": 1, "order": 7 },
    "api_ratio":    { "on": false, "row": 1, "order": 8 },
    "5h":           { "on": true,  "row": 2, "order": 1, "amber": 75, "red": 90 },
    "burn":         { "on": true,  "row": 2, "order": 1.5 },
    "7d":           { "on": true,  "row": 2, "order": 2, "amber": 75, "red": 90 },
    "peak":         { "on": true,  "row": 2, "order": 3, "start": 5, "end": 11 },
    "model":        { "on": true,  "row": 3, "order": 0.5 },
    "session_name": { "on": false, "row": 3, "order": 1 }
  }
}
```

### Global keys

- `numbers`: `compact` (`38k`) or `exact` (`38000`) for token magnitudes.
- `ttl` *(global key)*: cache time-to-live used to color the `ttl` segment — `auto` (recommended), `60`, or `5` minutes.
- `percentage`: `consumed` (default) counts up — `ctx:19%` is 19% used, `5h:67%`
  is 67% of the budget gone. `remaining` flips the **budget/occupancy** segments
  to count down — `ctx:81%`, `5h:33%` — so "how much is left?" reads consistently.
  Only `ctx`, `5h` and `7d` flip; `cache%` (a hit-rate, not a budget) and `ttl`
  (a countdown) are unaffected, and the `[38k]` magnitude is always absolute.
  **`amber`/`red` thresholds are always expressed in consumed terms regardless of
  this setting.**

### Per-segment keys

Every segment accepts `on` (boolean), `row` (1, 2, or 3), and `order` (any number —
lower = further left). Colored segments additionally accept threshold keys.

**Row layout:**

- **Row 1** — stats, two zones separated by ` | `:
  ```
  [ctx · cache · write · ttl · effort · thinking · api_ratio] | [cost]
  ```
  All segments within a zone are also separated by ` | `. Segments moved off
  their default row via config must land in a zone to appear on row 1.
- **Row 2** — rate-limit windows, all segments separated by ` | `, ordered by `order`.
  Hidden entirely for API users (no `rate_limits` in stdin).
- **Row 3** — identity, segments separated by ` | `, ordered by `order`.
  Suppresses itself when all its segments are off or absent.

**Threshold keys** (`amber`, `red`, `orange` where applicable):

- `ctx`: percent of the `basis` fullness reference. Default `amber: 30`, `orange: 40`, `red: 50`.
- `ttl` *(segment)*: percent of the resolved cache TTL *consumed*. Default `amber: 50`, `red: 80`.
- `5h` / `7d`: absolute `used_percentage`. Default `amber: 75`, `red: 90`.

**`ctx`-specific keys:**
- `basis`: `window` (default) colors off `used_percentage` of the real context
  window; `ceiling` colors off `total_input_tokens / ceiling`, so the warning
  fires at the same **absolute** token count on any window. On a 1M model the
  window basis stays green well past where quality degrades, so set `ceiling`
  if you want an early warning that doesn't scale with the window size.
- `ceiling`: token count the `ceiling` basis measures against (default `200000`).
- `display`: with `basis: "ceiling"`, `basis` (default) shows the % toward the
  ceiling so number and color agree; `window` shows CC's window figure but still
  colors by the ceiling. No effect under `basis: "window"`.

**`peak`-specific keys:**
- `start` / `end`: hours in Pacific time (0–23, exclusive end) bounding
  Anthropic's faster-drain window. Defaults `5`–`11`. Weekday-only (Mon–Fri) and
  the `America/Los_Angeles` reference are hardcoded policy facts, not config.

## Segments

| Segment | Default | Example | Meaning | Color |
|---|---|---|---|---|
| `ctx` | on, row 1 | `ctx:19% [38k]` | context-window occupancy + input-token magnitude | `<30` green · `30–40` amber · `40–50` orange · `≥50` red |
| `cache` | on, row 1 | `cache:95%` | last-turn cache hit rate (reads / total tokens) | neutral |
| `write` | **off**, row 1 | `write:4%` | last-turn cache creation rate (new writes / total tokens) | neutral |
| `ttl` | on, row 1 | `ttl:00:52` | time remaining before cache expires (counts down to 00:00) | `<50%` green · `50–80%` amber · `≥80%` red |
| `cost` | on, row 1 | `~$4.50` | session cost incl. subagents; `~` = CC's estimate | neutral; hidden when zero |
| `effort` | **off**, row 1 | `effort:high` | reasoning effort level | neutral |
| `thinking` | **off**, row 1 | `think:on` | thinking mode indicator | neutral |
| `api_ratio` | **off**, row 1 | `∿ api:74%` | fraction of wall time spent on API calls | neutral |
| `5h` | on, row 2 | `5h:23% ↺ 2h14m` | 5-hour rate-limit window + reset countdown | `≥75` amber · `≥90` red |
| `burn` | on, row 2 | `~38m` | estimated minutes until 5h cap at current pace | neutral; hidden when ETA > 5h or no prior sample |
| `7d` | on, row 2 | `7d:41% ↺ 4d` | weekly rate-limit window + reset countdown | same as 5h |
| `peak` | on, row 2 | `peak` | weekday PT window where 5h drains faster | amber; hidden outside window |
| `model` | on, row 3 | `Sonnet 4.6` | current model name | none |
| `session_name` | **off**, row 3 | `My project session` | conversation name from CC | none |

Any segment hides cleanly when its source field is absent (API users have no
`rate_limits`; `current_usage` is null right after `/compact`; etc.).

Row 2 is hidden entirely for API users (no `rate_limits` in stdin).
Row 3 suppresses itself when all its segments are hidden.

## Development

The runtime uses only Node built-ins and local modules, with no runtime
dependencies. Tests are Cucumber scenarios, one feature per vertical slice, run
with cucumber-js (a dev-only dependency):

```bash
npm install
npm test
```

## License

MIT.
