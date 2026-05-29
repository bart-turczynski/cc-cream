# Changelog

All notable changes to cc-cream are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.10] — 2026-05-29

### Added
- **Setup reminder after plugin install** (CREAM-cpcwjkxi). Installing the plugin makes the commands available but can't wire the status bar (Claude Code has no install hook to write `settings.json`), so users saw no bar and didn't know to run `/cc-cream:setup`. A `SessionStart` hook (`hooks/hooks.json`, auto-discovered) now emits a one-line `systemMessage` nudging the user to run `/cc-cream:setup` — but **only while cc-cream's statusLine is absent**, so it self-silences once setup runs. `systemMessage` is shown to the user and adds **nothing** to the model context (zero tokens). Degrades safely: missing `settings.json` → nudge; malformed → silent; always exits 0. Biome now also lints `hooks/`.

## [0.1.9] — 2026-05-29

### Fixed
- **`/cc-cream:setup` and `/cc-cream:uninstall` no longer hang on a y/N prompt** (CREAM-vxbbrypj). The slash commands run `install.js` via Claude Code's bang execution, which has no interactive TTY, so install.js's readline prompts blocked forever — the uninstaller's "delete runtime/state?" prompt was the dead end. install.js now detects a missing TTY and resolves prompts non-interactively: uninstall removes the `statusLine` and **keeps** the runtime/state artifacts (re-run in a terminal or pass `--purge` to delete them); setup overwrites an existing *cc-cream* `statusLine` but never clobbers a foreign one without a terminal or the new `--force`/`--yes` flag. Interactive terminals are unchanged. (Plugin removal still takes two steps — `/cc-cream:uninstall` then `/plugin uninstall cc-cream` — because Claude Code has no plugin-uninstall hook to clean `settings.json` automatically.)

## [0.1.8] — 2026-05-29

### Added
- **`cc-cream-setup` bin for npm users** (CREAM-gvrvnhsc). `npm install -g cc-cream` now exposes a first-class `cc-cream-setup` command (and `cc-cream-setup --uninstall` / `--purge`) that runs the consent installer, replacing the clunky `node $(npm root -g)/cc-cream/src/install.js`. The existing `cc-cream` bin remains the status-line renderer.
- **CI workflow that runs the publish gate on a CLI-less runner** (CREAM-xzhidmjt). `.github/workflows/ci.yml` runs `npm test` — the exact command `prepublishOnly` runs — on every PR and push to `main`, and asserts the `claude` CLI is absent so it mirrors the npm-publish environment.

### Changed
- **Publish gate is now CI-safe by construction** (CREAM-xzhidmjt). Scenarios that shell out to a live `claude` are tagged `@needs-cli` and excluded from the default cucumber profile (`not @manual and not @needs-cli`); run them with `npm run test:cli`. Previously such a scenario could go `pending` on a runner without the CLI and silently break `npm publish` — now any regression of that kind fails on the PR instead.

## [0.1.7] — 2026-05-29

### Fixed
- **Marketplace install failed with `commands: Invalid input`** (regression from 0.1.6). The install-time manifest schema rejects a `commands` array of file paths in `plugin.json`, even though `claude plugin validate` (which is more lenient) accepts it — so the 0.1.6 "fix" passed local validation but still broke real installs. Removed the `commands` key entirely and moved the command files back to a top-level `commands/` directory (plugin root), letting Claude Code auto-discover them. This matches the official `ralph-loop` plugin layout. Verified end-to-end with a real `claude plugin install` from a local marketplace.

## [0.1.6] — 2026-05-29

### Fixed
- **Plugin commands still not appearing after installation.** The validator resolves `commands` paths in `plugin.json` relative to `.claude-plugin/`, and also requires the file to exist at that path. Moved command files from `commands/` (repo root) to `.claude-plugin/commands/`, so `./commands/setup.md` now correctly resolves to `.claude-plugin/commands/setup.md`. `${CLAUDE_PLUGIN_ROOT}` in the command bodies is unaffected — it always points to the plugin root.

## [0.1.5] — 2026-05-29

### Fixed
- **TTL falsely resets after non-API Claude Code events** (e.g. `/plugin update`). The TTL anchor was the `mtime` of the transcript file, which updates whenever Claude Code writes any event to the transcript — not just API turns. The anchor is now derived from session state: when `total_input_tokens` grows between renders (indicating a real API turn), `last_api_ts` is stored and used as the anchor on subsequent renders. Falls back to transcript mtime only on the first render before any state exists.
- **Plugin command paths fixed for real** (reverts the `../` change from 0.1.3). The Claude Code plugin validator rejects `..` path traversal; command paths in `plugin.json` resolve from the plugin root, not from `.claude-plugin/`, so `./commands/setup.md` is correct.

## [0.1.4] — 2026-05-29

### Fixed
- **Node DEP0190 deprecation warning during setup.** `resolveNodePath()` called `execFileSync('command', ['-v', 'node'], { shell: true })`, which Node warns about because args are concatenated rather than escaped when `shell` is true. Switched to `execSync('command -v node')` — no behavior change, warning gone.

## [0.1.3] — 2026-05-29

### Fixed
- **Plugin commands not registered.** `plugin.json` listed command paths as `./commands/setup.md` (relative to `.claude-plugin/`), which Claude Code cannot resolve. Changed to `../commands/setup.md` so the paths correctly point to the `commands/` directory at the repo root.

## [0.1.2] — 2026-05-29

### Changed
- **No install-time lifecycle scripts in the published package.** The git-hook
  registration moved off the `prepare` lifecycle to an opt-in `npm run hooks`,
  so `npm install`/`npx cc-cream` runs nothing automatically. Improves the
  supply-chain posture (and Socket score) with no change to the runtime.

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

[0.1.6]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bart-turczynski/cc-cream/releases/tag/v0.1.0
