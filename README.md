# cc-cream

**C.R.E.A.M. — Cache Rules Everything Around Me.** A single-file status-line tool
for [Claude Code](https://claude.com/claude-code) that turns the JSON Claude Code
pipes to its status line into a glanceable, colored ≤2-row bar:

```
Opus 4.7 (1M context) | ctx:19% (38k) cache:95% idle:00:00 | ~$4.50
5h:23%·2h14m  7d:41%·4d
```

It helps you **avoid rate limits, keep the cache warm, and keep context from
filling to where the model degrades** — with cache economics as the organizing
story. The model never sees the output, so it **costs zero tokens**.

Row 1 is this session: `model · ctx · cache · idle · cost`.
Row 2 is your account windows: `5h · 7d` (subscribers only — API users get one row).

## Requirements

- **Node.js** (you already have it — Claude Code is a Node app). No other runtime,
  no `jq`, no dependencies.
- **Claude Code ≥ 2.1.132** (2026-05-06). The cache figure needs
  `context_window.current_usage`, which landed in that release. The optional
  `effort`/`thinking` segments additionally need 2.1.145 and stay hidden below it.

## Install (raw `.js` from GitHub)

v1 ships a single channel: the raw `.js` file. (npm and a marketplace plugin are
planned for v2.)

1. **Download** the engine to your Claude config directory:
   ```bash
   mkdir -p ~/.claude/cc-cream
   curl -fsSL https://raw.githubusercontent.com/<owner>/cc-cream/main/src/cc-cream.js \
     -o ~/.claude/cc-cream/cc-cream.js
   ```
2. **Run the consent installer**, which shows the change and writes one
   `statusLine` line into your `~/.claude/settings.json`:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/<owner>/cc-cream/main/src/install.js \
     -o ~/.claude/cc-cream/install.js
   node ~/.claude/cc-cream/install.js
   ```
   The installer detects an existing `statusLine` and **asks before replacing it**,
   **preserves any `padding`** you set, and is **idempotent** (re-running changes
   nothing).
3. Claude Code must be **trusted** for the folder, and you may need to **restart**
   it for the bar to appear.

The installer writes:

```json
"statusLine": {
  "type": "command",
  "command": "node ~/.claude/cc-cream/cc-cream.js",
  "refreshInterval": 60
}
```

The 60-second refresh advances the idle timer while you're present-but-idle;
active work redraws on every assistant message.

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

- `numbers`: `compact` (`38k`) or `exact` (`38000`).
- `ttl`: cache-TTL for idle coloring — `auto` (recommended), `60`, or `5` minutes.
- Per segment: `on`, `row` (1 or 2), `order`, and for colored segments the
  `amber`/`red` lower bounds. For `ctx`/`5h`/`7d` these are absolute
  `used_percentage`; for `idle` they are **percent of the resolved TTL**.

## Segments

| Segment | Example | Meaning | Color (default) |
|---|---|---|---|
| model | `Opus 4.7 (1M context)` | current model | none |
| ctx | `ctx:19% (38k)` | current-context occupancy + input-token magnitude | `<25` green · `25–40` amber · `≥40` red |
| cache | `cache:95%` | last-turn cache hit rate | neutral |
| idle | `idle:00:00` | time since last activity vs cache TTL | `<50%` green · `50–80%` amber · `≥80%` red |
| cost | `~$4.50` | session cost (incl. subagents); `~` = estimate | neutral; hidden when zero |
| 5h | `5h:23%·2h14m` | 5-hour rate-limit window + reset countdown | `≥75` amber · `≥90` red |
| 7d | `7d:41%·4d` | weekly rate-limit window + reset countdown | same as 5h |
| effort | `effort:high` | reasoning effort (off by default) | neutral |
| thinking | `think:on` | thinking indicator (off by default) | neutral |

Any segment hides cleanly when its source field is absent (API users have no
`rate_limits`; `current_usage` is null right after `/compact`; etc.).

## Development

The engine is one file using only Node built-ins. Tests are Cucumber scenarios,
one feature per vertical slice, run with cucumber-js (a dev-only dependency):

```bash
npm install
npm test
```

## License

MIT.
