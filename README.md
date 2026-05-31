# cc-cream

[![CI](https://img.shields.io/github/actions/workflow/status/bart-turczynski/cc-cream/ci.yml?branch=main&label=CI)](https://github.com/bart-turczynski/cc-cream/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/cc-cream)](https://www.npmjs.com/package/cc-cream)
[![Socket Badge](https://socket.dev/api/badge/npm/package/cc-cream)](https://socket.dev/npm/package/cc-cream)
[![Snyk security](https://snyk.io/test/npm/cc-cream/badge.svg)](https://security.snyk.io/package/npm/cc-cream)
[![install size](https://img.shields.io/bundlephobia/minzip/cc-cream)](https://bundlephobia.com/package/cc-cream)
[![License: MIT](https://img.shields.io/npm/l/cc-cream)](https://github.com/bart-turczynski/cc-cream/blob/main/LICENSE)

**The status bar Claude Code should have shipped with.**

*C.R.E.A.M. — Claude Code · Cache Rules Everything Around Me*

![cc-cream status bar](assets/screenshot.png)

Keeps your cache health, context fill, rate-limit budgets, and session cost visible at all times — in a colored ≤3-row bar the model never sees. Zero tokens.

With all segments enabled:

```
ctx:21% [43k] | cache:99% | write:2% | ttl:60 | effort:high | think:on | ∿ api:74% | ~$0.23
5h:13% ↺2h57m | ~3h12m | 7d:6% ↺Sat 21:00 | peak
Sonnet 4.6 | My project session
```

**Row 1 — this session:** context-window fill, cache hit rate, TTL countdown, session cost. Optional: cache write rate, effort level, thinking mode, API time ratio.

**Row 2 — rate-limit budgets:** 5h and 7d window usage with reset countdowns and a burn-rate projection. Hidden for API users.

**Row 3 — identity:** model name and session name.

## Features

**Cache health.** `cache` shows your hit rate each turn and turns red when it drops sharply — the only signal you'll get that a compaction, a far-back edit, or a large tool result just invalidated your cache prefix. `ttl` counts down to when the cache goes cold, turning amber then red as the window closes. Supports both 5-minute (API) and 60-minute (subscriber) TTLs, auto-detected.

**Rate-limit budgets.** `5h` and `7d` show how much of your rolling usage is gone and when each window resets. `burn` adds a live projection based on your current pace — useful before committing to a long agent run.

**Peak hours.** Anthropic's rate-limit drain accelerates Mon–Fri during Pacific business hours. The `peak` segment lights up when you're in that window so you can pace yourself accordingly. No other Claude Code status tool surfaces this.

**Context window.** `ctx` shows occupancy and input-token magnitude. On large-context models where "50% of window" still means 500k tokens, you can set a fixed-token ceiling instead — warnings fire at the same absolute count regardless of window size.

**Session cost.** Cumulative spend including subagents, as estimated by Claude Code. Hidden when zero.

## Trust

No network calls, no telemetry, no runtime dependencies — Node built-ins only. The only output is a string written to stdout; the model never receives it. The only file written is `~/.claude/cc-cream-state.json` (session samples for the burn projection and drop detection). See [PRIVACY.md](PRIVACY.md) and [SECURITY.md](SECURITY.md).

## Requirements

- **Node.js** — already present; Claude Code is a Node app.
- **Claude Code ≥ 2.1.132** (released 2026-05-06). The cache figure requires `context_window.current_usage`, which landed in that release.
- `effort` and `thinking` segments additionally require **Claude Code ≥ 2.1.145**; they stay hidden on older versions.

## Platform support

macOS and Linux. Windows is a planned fast-follow.

## Install

### Option 1 — Claude Code plugin (recommended)

```bash
/plugin marketplace add bart-turczynski/cc-cream
/plugin install cc-cream
```

On the first session after install cc-cream auto-wires its `statusLine` into `~/.claude/settings.json`. It only does this when the slot is free — it never overwrites a statusLine you set for something else, and it never re-adds the bar after you remove it.

If you already have a statusLine and want to replace it with cc-cream's:
```
/cc-cream:setup
```

Updates are automatic: `/plugin update` drops a new version into the cache; the next render picks it up.

### Option 2 — npm

```bash
npm install -g cc-cream
cc-cream-setup
```

Or without a global install:
```bash
npx -y -p cc-cream cc-cream-setup
```

### Option 3 — Manual

Download or clone the repository, then run the consent installer:

```bash
git clone https://github.com/bart-turczynski/cc-cream.git
node cc-cream/src/install.js
```

The installer detects an existing `statusLine` and asks before replacing it, preserves any `padding` you have set, and is idempotent.

After install, Claude Code must be **trusted** for the directory (if prompted) and you may need to **restart** for the bar to appear.

> **Pick one install method.** If you wire cc-cream via npm/manual and then install the plugin, run `/cc-cream:setup` to switch to the auto-updating plugin path. Nothing breaks either way — it just stays on whichever method wired it.

## Uninstall

Plugin users — run in this order:
```
/cc-cream:uninstall
/plugin uninstall cc-cream
```

npm / manual users:
```bash
cc-cream-setup --uninstall
```

Add `--purge` to either to also remove your `~/.claude/cc-cream.json` config. See [UNINSTALL.md](UNINSTALL.md) for edge cases and manual cleanup.

## Configuration

Every display decision is driven by `~/.claude/cc-cream.json`. You don't have to edit it by hand — just ask Claude to toggle segments, flip how percentages are counted, or adjust thresholds. The defaults are based on what the data and community experience suggest are reasonable starting points.

If you do edit by hand, run the doctor afterward to catch typos:
```bash
cc-cream-setup --check-config
```

Full reference: [CONFIGURATION.md](CONFIGURATION.md).

## Troubleshooting

cc-cream degrades silently — missing or malformed data hides the segment rather than crashing. When the bar is unexpectedly empty or shorter than expected:

```bash
export CC_CREAM_DEBUG=1   # then trigger a render in Claude Code
```

Each render appends a diagnostic line to `~/.claude/cc-cream-debug.log` (override with `CC_CREAM_DEBUG_LOG`) listing which segments rendered, which were dropped, the resolved TTL, and stdin size. Unset to turn off.

## Development

See [CONTRIBUTING.md](CONTRIBUTING.md). The runtime uses only Node built-ins — no runtime dependencies.

## License

MIT — see [LICENSE](LICENSE).
