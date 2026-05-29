# Changelog

All notable changes to cc-cream are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] — 2026-05-29

### Added
- **Uninstall** — `node src/install.js --uninstall` (and the `/cc-cream:uninstall`
  plugin command) removes cc-cream's `statusLine` block, but only when it is
  cc-cream's; a foreign statusLine is left untouched. Offers to delete the copied
  runtime and session-state files, and keeps `~/.claude/cc-cream.json` unless
  `--purge` is passed.

### Fixed
- **Never overwrite a malformed `settings.json`** — the installer now refuses to
  write when `settings.json` exists but fails to parse (or is not a JSON object),
  instead of silently starting fresh and erasing the user's other settings.

## [0.1.0] — 2026-05-29

Initial public release. cc-cream reads the JSON Claude Code pipes to its status
line and prints a colored ≤3-row bar — zero tokens, the model never sees it.

### Added
- **Status-line engine** — fourteen configurable segments across up to three
  rows: `ctx`, `cache`, `write`, `ttl`, `effort`, `thinking`, `api_ratio`,
  `cost` (row 1); `5h`, `7d`, `burn`, `peak` (row 2, hidden for API users);
  `model`, `session_name` (row 3). Node built-ins only, no runtime dependencies.
- **Per-session state** keyed by `session_id` for burn-rate projection, cost
  delta on `/clear`, and cache-drop detection.
- **Configuration** via `~/.claude/cc-cream.json` — every display decision
  (on/off, row, order, thresholds, colors) is data-driven, with per-field and
  whole-file fallback. Degrades gracefully: malformed input never crashes.
- **Distribution as a Claude Code plugin** — `.claude-plugin/plugin.json` and a
  self-hosted `marketplace.json`. Install with
  `/plugin marketplace add bart-turczynski/cc-cream` then `/plugin install cc-cream`.
- **`/cc-cream:setup` command** that wires the status line into `settings.json`
  with a self-resolving cache-glob command, so `/plugin update` applies new
  versions automatically with no network calls and no re-run of setup.
- **npm distribution** — `cc-cream` bin with a node shebang; installable via
  `npx -y cc-cream@latest`.
- **Consent-based installer** (`src/install.js`) for the manual / GitHub path:
  copies the runtime into `~/.claude/cc-cream` and writes one `statusLine` block,
  preserving any existing configuration and asking before replacing it.
- **Docs & trust** — user-facing README, `SECURITY.md`, `CONTRIBUTING.md`, and a
  prominent disclosure: no network calls, no telemetry, no runtime dependencies.

### Notes
- Supports **macOS and Linux**; Windows is a planned fast-follow.
- Requires Claude Code **2.1.132+** (`effort` / `thinking` need 2.1.145+).

[0.1.1]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bart-turczynski/cc-cream/releases/tag/v0.1.0
