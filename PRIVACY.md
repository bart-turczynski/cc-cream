# Privacy Policy — cc-cream

**Effective date:** 2026-05-29

## Summary

cc-cream collects no personal data and makes no network requests. Everything runs locally on your machine.

## What cc-cream does

cc-cream is a Claude Code status-line tool. Claude Code pipes a JSON blob to its stdin; cc-cream reads that blob, renders a colored status bar, and writes the output to stdout. The model never sees the output.

## Data processed

cc-cream reads the following fields from the JSON Claude Code provides on stdin:

- Model name and context-window metrics (context usage, cache token counts)
- Session cost (`total_cost_usd`) and rate-limit window usage
- Session ID and transcript path (used to compute cache idle time)

This data is provided by Claude Code itself and is already present on your local machine. cc-cream never transmits it anywhere.

## Local storage

cc-cream writes two files, both inside `~/.claude/`:

| File | Contents | Purpose |
|------|----------|---------|
| `cc-cream-state.json` | Per-session cache %, cost, timestamp, rate-limit snapshot | Lets the idle timer and drop-detection work across invocations |
| `cc-cream.json` | Your display preferences (colors, thresholds, segment order) | User configuration; only created if you hand-write it |

The installer (`cc-cream install`) also edits `~/.claude/settings.json` to add the `statusLine` command. It asks for consent before making any change.

## No telemetry, no analytics, no external servers

cc-cream contains no analytics code, makes no HTTP requests, and does not phone home. You can verify this: the source is fully open at <https://github.com/bart-turczynski/cc-cream> and has no runtime dependencies outside Node.js built-ins.

## Third-party services

None. cc-cream is a pure local tool.

## Changes

If this policy changes in a material way, the change will be noted in [CHANGELOG.md](CHANGELOG.md) and the effective date above will be updated.

## Contact

Questions or concerns: [support@spoonkeyworks.com](mailto:support@spoonkeyworks.com)
