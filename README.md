# cc-cream

**C.R.E.A.M. — Cache Rules Everything Around Me.**

A lightweight status-line tool for [Claude Code](https://claude.com/claude-code)
that turns the JSON Claude Code pipes to its status line into a glanceable,
colored ≤3-row bar. The model **never sees the output** — it costs **zero tokens**.

## What it shows

```
ctx:3% [30k] | cache:55% | ~$0.10
5h:22% ↺ 0m | 7d:36% ↺ Sat 21:00
Opus 4.7 (1M context) | example session
```

> Rendered from a live Claude Code subscriber session (fixtures/subscriber.golden.json).
> A proper screenshot or asciinema recording will appear here after public release.

- **Row 1** — this session: context-window occupancy, cache hit rate, session cost
- **Row 2** — rate-limit budget windows: 5h and 7d usage + reset countdown (subscribers only; API users get one row)
- **Row 3** — identity: model name and optional session name

The bar helps you avoid rate limits, keep the cache warm, and catch context fill
before the model degrades — with cache economics as the organizing story.

## Trust and data posture

- **No network calls.** The engine is a pure stdin → stdout transformer. It never
  opens a socket, fetches a URL, or calls home.
- **No telemetry.** Nothing is collected, reported, or logged anywhere.
- **No runtime dependencies.** Node built-ins only. `npm install` is for dev tools
  (Cucumber, Biome) — nothing that runs at render time.
- **Zero tokens.** Claude Code reads the bar output to display it; the model never
  receives it.

The only I/O is reading the JSON blob Claude Code pipes on stdin and writing one
session-state file to `~/.claude/cc-cream-state.json` (keyed by session ID,
contains cost and rate-limit samples used for the burn projection).

## Requirements

- **Node.js** — already present; Claude Code is a Node app.
- **Claude Code ≥ 2.1.132** (released 2026-05-06). The cache figure requires
  `context_window.current_usage`, which landed in that release.
- The `effort` and `thinking` segments additionally require **Claude Code ≥ 2.1.145**;
  they stay hidden below that version.

## Platform support

v1 supports **macOS and Linux**. Windows support is a planned fast-follow; the
engine is pure Node and the only blocker is the statusLine shell-command wiring.

## Install

### Option 1 — Claude Code plugin (community catalog / self-hosted marketplace)

If cc-cream is listed in the community catalog:
```bash
/plugin install cc-cream
```

To use the self-hosted marketplace directly:
```bash
/plugin marketplace add bart-turczynski/cc-cream
/plugin install cc-cream
```

That's usually all you need: on the first session after install, cc-cream
**auto-wires** its `statusLine` into `~/.claude/settings.json` (you may need to
restart or trust the workspace for the bar to appear). It only does this when no
status line is configured — it never overwrites one you set for something else,
and it never re-adds the bar after you remove it.

If you already have a status line and want to replace it with cc-cream's, run:
```
/cc-cream:setup
```

The `/cc-cream:setup` command runs the consent installer, which writes the
`statusLine` block to `~/.claude/settings.json`. Updates are automatic: when
`/plugin update` drops a new version into the cache, the next render picks it up
without any further action.

### Option 2 — npm

```bash
npm install -g cc-cream
```

Then wire it into Claude Code with the bundled CLI:
```bash
cc-cream-setup
```

`cc-cream-setup` runs the consent installer (`src/install.js`). Without a global
install you can run it through npx:
```bash
npx -y -p cc-cream cc-cream-setup
```

### Option 3 — Manual GitHub clone

Download and install by cloning the repository, then run the consent installer:
```bash
git clone https://github.com/bart-turczynski/cc-cream.git
node cc-cream/src/install.js
```

The installer:
- Detects an existing `statusLine` and **asks before replacing it**
- **Preserves any `padding`** you have set
- Is **idempotent** — re-running when cc-cream is already installed changes nothing
- States the trust and restart requirement

After install, Claude Code must be **trusted** for the directory (if prompted),
and you may need to **restart** it for the bar to appear.

> **Pick one install method.** If you wire cc-cream via npm/manual (Options 2–3)
> and *then* install the plugin, the plugin won't take over the existing wiring —
> it points at your home copy, so `/plugin update` won't auto-update the bar. To
> switch to the auto-updating plugin, run `/cc-cream:setup` (or `cc-cream-setup
> --uninstall` first). Nothing breaks either way; it just stays on whichever
> method wired it.

### Uninstall

Plugin users — two steps, **in this order** (Claude Code can't clean
`settings.json` when a plugin is removed, so the wiring is cleared separately
from the cache):
```
/cc-cream:uninstall          # 1. removes the statusLine wiring (run this FIRST)
/plugin uninstall cc-cream   # 2. drops the plugin from the cache
```

> **Order matters.** `/cc-cream:uninstall` lives inside the plugin, so once you
> run `/plugin uninstall` it's gone. The status line itself degrades to nothing
> if the cache is missing (it won't error), but the now-inert `statusLine` block
> lingers in `settings.json`. To clear it after the plugin is already gone, run
> the npm bin (no global install needed):
> ```bash
> npx -y -p cc-cream cc-cream-setup --uninstall
> ```
> or remove the `statusLine` key from `~/.claude/settings.json` by hand.

npm / manual users:
```bash
cc-cream-setup --uninstall                 # npm (add --purge to also remove runtime + config)
node cc-cream/src/install.js --uninstall   # manual clone
```

Uninstall removes the `statusLine` block **only if it is cc-cream's** — a
statusLine you wired for something else is left untouched. In a terminal it asks
before deleting the copied runtime and session-state files; run **non-interactively**
(as the `/cc-cream:uninstall` slash command does) it leaves those artifacts in
place — pass `--purge` to remove them and your `~/.claude/cc-cream.json` config.
Restart Claude Code to clear the bar.

Likewise, `cc-cream-setup` run non-interactively will overwrite an existing
*cc-cream* statusLine but never a foreign one — pass `--force` to replace
regardless.

## Configuration

Every display decision is read from `~/.claude/cc-cream.json`. Edit it by hand
or ask Claude to. It is strict JSON with no comments. **Every field falls back to
its built-in default if missing or malformed** — a typo degrades one value rather
than breaking the bar; a whole-file parse error falls back to all defaults.

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

- `numbers`: `compact` (e.g. `38k`) or `exact` (`38000`) for token magnitudes.
- `ttl`: cache time-to-live used to color the `ttl` segment — `auto` (recommended),
  `60`, or `5` minutes. `auto` infers from rate-limit data when available.
- `percentage`: `consumed` (default) counts up — `ctx:19%` means 19% of the window
  is used, `5h:67%` means 67% of the 5h budget is gone. `remaining` flips the
  budget/occupancy segments to count down (`ctx:81%`, `5h:33%`). Only `ctx`, `5h`
  and `7d` flip; `cache%` (a hit-rate, not a budget) and `ttl` (a countdown) are
  unaffected. **Thresholds are always expressed in consumed terms regardless of
  this setting.**

### Per-segment keys

Every segment accepts:
- `on` (boolean) — whether to show the segment
- `row` (1, 2, or 3) — which row to place it on
- `order` (any number) — lower = further left within the row

Colored segments additionally accept threshold keys. Thresholds mark the
**lower bound** where that color begins.

### Segment catalog

| Segment | Default | Example | Meaning | Color |
|---|---|---|---|---|
| `ctx` | on, row 1 | `ctx:19% [38k]` | context-window occupancy + input-token magnitude | `<30` green · `30–40` amber · `40–50` orange · `≥50` red |
| `cache` | on, row 1 | `cache:95%` | last-turn cache hit rate (reads / total tokens) | neutral |
| `write` | **off**, row 1 | `write:4%` | last-turn cache creation rate (new writes / total tokens) | neutral |
| `ttl` | on, row 1 | `ttl:00:52` | time remaining before cache expires (counts down to 00:00) | `<50%` green · `50–80%` amber · `≥80%` red |
| `cost` | on, row 1 | `~$4.50` | session cost incl. subagents; `~` = CC's estimate | neutral; hidden when zero |
| `effort` | **off**, row 1 | `effort:high` | reasoning effort level (requires CC ≥ 2.1.145) | neutral |
| `thinking` | **off**, row 1 | `think:on` | thinking mode indicator (requires CC ≥ 2.1.145) | neutral |
| `api_ratio` | **off**, row 1 | `∿ api:74%` | fraction of wall time spent on API calls | neutral |
| `5h` | on, row 2 | `5h:23% ↺ 2h14m` | 5-hour rate-limit window + reset countdown | `≥75` amber · `≥90` red |
| `burn` | on, row 2 | `~38m` | estimated minutes until 5h cap at current pace | neutral; hidden when ETA > 5h or no prior sample |
| `7d` | on, row 2 | `7d:41% ↺ 4d` | weekly rate-limit window + reset countdown | same as 5h |
| `peak` | on, row 2 | `peak` | weekday Pacific-time window where 5h drains faster | amber; hidden outside window |
| `model` | on, row 3 | `Sonnet 4.6` | current model name | none |
| `session_name` | **off**, row 3 | `My project session` | conversation name from CC | none |

Any segment hides cleanly when its source field is absent — API users have no
`rate_limits`; `current_usage` is null right after `/compact`; etc.

Row 2 is hidden entirely for API users (no `rate_limits` in stdin).
Row 3 suppresses itself when all its segments are hidden.

### Row 1 layout

Row 1 has two zones separated by ` | `:

```
[ctx · cache · write · ttl · effort · thinking · api_ratio] | [cost]
```

Segments within zone 1 are also separated by ` | `. Segments moved off their
default row via config must land in a zone to appear on row 1.

### `ctx`-specific keys

- `basis`: `window` (default) colors based on `used_percentage` of the real context
  window. `ceiling` colors based on `total_input_tokens / ceiling`, so the warning
  fires at the same absolute token count on any window size. On a 1M-context model
  the window basis stays green well past where quality degrades — set `ceiling` if
  you want an early warning that doesn't scale with the window.
- `ceiling`: token count the `ceiling` basis measures against. Default `200000`.
- `display`: with `basis: "ceiling"`, `basis` (default) shows the % toward the
  ceiling so number and color agree; `window` pins it to CC's window figure but
  still colors by the ceiling. No effect under `basis: "window"`.

### `ctx` thresholds

Default: `amber: 30`, `orange: 40`, `red: 50` (percent consumed).

### `ttl` thresholds

Default: `amber: 50`, `red: 80` (percent of the resolved TTL consumed).

### `5h` / `7d` thresholds

Default: `amber: 75`, `red: 90` (absolute `used_percentage`).

### `peak`-specific keys

- `start` / `end`: hours in Pacific time (0–23, exclusive end) bounding
  Anthropic's faster-drain window. Defaults `5`–`11`. Weekday-only (Mon–Fri) and
  the `America/Los_Angeles` timezone are hardcoded policy facts, not config.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the tests. The runtime
uses only Node built-ins — no runtime dependencies.

## License

MIT — see [LICENSE](LICENSE).
