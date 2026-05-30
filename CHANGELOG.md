# Changelog

All notable changes to cc-cream are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed
- **`npm run coverage` (and the pre-push hook) no longer crash on Node ≥ 26.** `c8@11` does `require('yargs/yargs')`, and yargs 17's `exports` map resolves that to an **extensionless** CJS file; under Node 26's `require(ESM)` loader an extensionless file in a `"type": "module"` package is parsed as ESM, throwing `ReferenceError: require is not defined in ES module scope`. This broke the `simple-git-hooks` pre-push gate, forcing `SKIP_SIMPLE_GIT_HOOKS=1` on every push. Pinned yargs to `^18.0.0` via `overrides` — its `./yargs` export is a proper `.mjs` that Node 26 loads cleanly, and `c8@11` works against it unchanged (all 248 scenarios green under coverage). Dev-only; no runtime-dependency or published-package impact.
- **The uninstall receipt's cache-path escape hatch is now copy-pasteable.** It printed `…/cc-cream/cc-cream/<version>/src/install.js`, but the receipt reaches the user through the `/cc-cream:uninstall` slash command, whose output Claude Code renders as **markdown — which strips `<version>` as an HTML-like tag**. The user saw `cc-cream//src` (empty version) and pasting it failed with `MODULE_NOT_FOUND`, breaking the documented npm-free recovery path exactly when it's needed. The receipt now prints install.js's own resolved absolute path — via the slash command that's the real versioned cache copy — so it's both version-accurate and free of any stripped placeholder. The README uses a markdown-safe `VERSION` placeholder with an `ls` hint to read off the real one (CREAM-rhtrzwss).

## [0.3.1] — 2026-05-30

### Fixed
- **`/cc-cream:setup` and `/cc-cream:uninstall` now actually show their result.** A `!` bang command's output is injected as model *context*, not displayed to the user (Claude Code's design), and the command bodies never told the model to surface it — so the install/uninstall *worked* but the model just replied "ready, what's next?" and the receipt (including how to clear the lingering cache) was never shown, on every model. Both command files now instruct the model to print the command output verbatim.

## [0.3.0] — 2026-05-30

### Added
- **`cc-cream-setup --status` — a read-only footprint report.** Because no Claude Code host removal path drops our `statusLine` or garbage-collects the version cache, users couldn't easily tell whether cc-cream had fully gone away. `--status` reports the whole footprint in one shot: the `statusLine` wiring (flagging a stale/ghost line whose entrypoint is missing), every cached plugin version, the marketplace clone + both registrations, the auto-wire marker, session state, config, and the manual runtime copy — with a "clean slate" verdict when nothing remains and removal guidance when something does (CREAM-zgdcbmfj).

### Fixed
- **The status bar no longer zombies after the plugin is uninstalled.** No Claude Code host removal path deletes our `statusLine` *or* the version cache: `/plugin uninstall` is partial (it deregisters the plugin but leaves the cache tree and our `statusLine`), so the entrypoint still exists and the `[ -f … ] || exit 0` guard can never fire — the bar kept rendering every session, with no in-product way out (`/cc-cream:uninstall` deregisters with the plugin). The renderer now defends itself: when it detects it's running **from the plugin cache** while cc-cream is **absent from `~/.claude/plugins/installed_plugins.json`**, it exits 0 silently. The check costs one tiny read and runs *only* on the plugin-cache path — manual/npm installs skip it entirely. A corrupt/unreadable registry is treated as "still installed" so a transient glitch can't suppress a live bar (CREAM-uchemxln).
- **Non-interactive `--force` no longer prints a contradictory "Declined … then replaced" receipt.** The installer's consent path printed the detection-only first plan pass — including a speculative "Declined — your existing statusLine is unchanged." — and then replaced the line anyway. It now resolves consent first and prints a single coherent result (CREAM-hpjebzes).

### Changed
- **Setup/uninstall copy now matches how the bar actually appears.** The status line shows on the **next message** of a new session — no restart needed; a restart only matters for an already-open session. The installer note, the `SessionStart` hook message, and the uninstall receipt were reworded accordingly (dropping the misleading "Restart Claude Code" framing) (CREAM-wvtiftfw).
- **`/cc-cream:uninstall` is now self-sufficient.** It auto-cleans the regenerable scratch (the copied runtime and `cc-cream-state.json`) with no prompt — the old interactive artifact prompt was dead code, since both the `!` bang runner and the slash commands run without a TTY. `--purge` additionally removes the user-authored `~/.claude/cc-cream.json`, and `commands/uninstall.md` now forwards `$ARGUMENTS` so `/cc-cream:uninstall --purge` actually reaches the script. The closing receipt enumerates the final state and the leftovers the host *doesn't* clean — the version cache (`rm -rf ~/.claude/plugins/cache/cc-cream`), `/plugin marketplace remove`, the slash commands that linger until restart, and the npm-free cache-path escape hatch (CREAM-lznfgrap, CREAM-wvtiftfw).

### Internal
- **One-command releases (`npm run release <patch|minor|major>`).** A new `scripts/release.mjs` bumps every version location in lockstep — `package.json`, `package-lock.json`, and `.claude-plugin/plugin.json` — and rolls the CHANGELOG's `[Unreleased]` section into a dated `## [x.y.z]` heading, gates on the test suite, then commits + tags (and pushes + creates the GitHub Release with `--publish`). It removes the hand-syncing every prior release required, where `npm version` touched only the first two and the version-match gate punished the drift. A new CI gate (`features/25`) now also asserts `plugin.json`'s version matches `package.json`, so that manifest can no longer go stale.

## [0.2.0] — 2026-05-30

### Added
- **`cc-cream-setup --check-config`** lints `~/.claude/cc-cream.json` and reports unknown keys and out-of-domain values — the fields the renderer silently falls back to defaults for. Exits non-zero when there's something to fix, so a typo'd key ("`ambre`", "`colour`") is no longer a silent no-op.
- **`CC_CREAM_DEBUG=1` opt-in diagnostics.** When the bar is unexpectedly empty or short, set it to log — to `~/.claude/cc-cream-debug.log` (override with `CC_CREAM_DEBUG_LOG`) — which on-by-default segments rendered and which were dropped, plus the resolved TTL window and stdin size. Claude Code discards status-line stderr, so the channel is a file; **stdout stays untouched** (zero tokens). Off by default: no file, no overhead.

### Changed
- **The plugin status line no longer resolves its version with a shell glob.** The wired command was `ls … | grep -E … | sort -V | tail -1` over the plugin cache, run on every render — it depended on GNU `sort -V` (not guaranteed in the status-line subprocess, notably on macOS) and reverse-engineered Claude Code's undocumented cache layout. `${CLAUDE_PLUGIN_ROOT}` doesn't expand in the status-line command context, so the command can't discover the current version itself. Instead the command now bakes the current version's **absolute** `cc-cream.js` path, and the `SessionStart` hook — which *does* receive `${CLAUDE_PLUGIN_ROOT}` — re-pins it after a `/plugin update`. Both install modes now share one command shape (`[ -f "<entrypoint>" ] || exit 0; exec "<node>" "<entrypoint>"`); the `[ -f … ]` guard preserves the silent exit-0 when the plugin cache is deleted out from under a stale line.

### Internal
- **Settings.json read/parse/atomic-write logic is shared** between the installer and the `SessionStart` hook via a new `src/settings.js`, instead of a copy in each.
- **Segment rendering is now pure.** The TTL anchor (including its `transcript_path` `statSync`) is resolved once in the I/O layer (`cc-cream.js`) and injected into `render()`, so `src/segments.js` no longer performs any filesystem access.
- **Config normalization is now a single schema table** (`src/config.js`) instead of an ad-hoc per-field conditional ladder. The same table powers `--check-config`, so validation rules live in one place.

## [0.1.18] — 2026-05-29

### Security
- **Status-line text is now stripped of terminal control characters before output.** Three stdin-derived fields — `model.display_name`, `session_name`, and `effort.level` — were written to the terminal verbatim on every render. Because `session_name` can be derived from conversation content (which may include untrusted material), an embedded ANSI/OSC escape sequence would have been interpreted by the terminal (window-title/clipboard rewrites via OSC, or cursor/erase sequences that spoof or hide output). `paint()` now passes every segment through a `sanitize()` pass that drops C0/C1 control bytes (incl. ESC, BEL, DEL) while preserving the tool's own color codes, which are added afterward. The bar is purely visual, so the strip is lossless.
- **A crafted `session_id` can no longer corrupt the session-state map.** `session_id` is used as an object key; values of `__proto__`/`constructor`/`prototype` are now rejected in `getSessionState`/`patchSessionState`, and reads use `Object.hasOwn`.

### Fixed
- **Writes to `settings.json` (and the state file) are now atomic.** `install.js`, the `SessionStart` auto-setup hook, and `state.js` wrote via a direct `writeFileSync` over the live file; an interruption (crash, `ENOSPC`) mid-write could truncate `settings.json` and erase the user's permissions/hooks/plugins/MCP config — the very loss `readSettings` works to avoid. They now write a sibling temp file and `rename` it over the target (atomic within a filesystem; the temp shares the target's directory so the rename never crosses devices).
- **The plugin auto-update command now quotes the node binary path** (`exec "${nodePath}"`), so a node path containing spaces no longer breaks the status line.

### Changed
- **The session-state map is capped at 50 entries**, evicting the least-recently-touched sessions. It previously gained one key per `session_id` and was never pruned, growing without bound.

## [0.1.17] — 2026-05-29

### Fixed
- **`cc-cream-setup` and the `/cc-cream:*` slash commands silently did nothing when `~/.claude` is a symlink.** `install.js` had the same symlink-fragile entrypoint guard fixed in the renderer for 0.1.16 (`import.meta.url` is canonicalized by Node's ESM loader; `process.argv[1]` is not), so running it from a symlinked path skipped `main()` entirely — exit 0, no output, settings.json untouched. The "am-I-the-entrypoint?" check is now a single symlink-robust helper (`isEntrypoint` in `src/utils.js`) shared by both `cc-cream.js` and `install.js`. Caught by the new install-journey smoke tests.

### Added
- **End-to-end install/uninstall journey smoke tests** (`features/27-install-journey.feature`, CREAM-fxsusmgd). They stage a real plugin cache the way `/plugin install` lays it out, run the actual `SessionStart` hook and `install.js` as child processes, and execute the baked statusLine command through `sh -c` exactly as Claude Code does — guarding the *seams* unit specs can't: cache layout, the settings.json lifecycle, command order, the empty-cache guard (0.1.15), and symlinked config dirs (0.1.16). CI-safe; no live `claude` CLI needed.

## [0.1.16] — 2026-05-29

### Fixed
- **The status bar silently rendered nothing when `~/.claude` is a symlink** (dotfile managers like stow/chezmoi/yadm, or an iCloud/Dropbox-synced config dir). The "am-I-the-entrypoint" guard compared `import.meta.url` (which Node's ESM loader canonicalizes — symlinks resolved) against `pathToFileURL(process.argv[1])` (left as-invoked, through the symlink). Under a symlinked path the two never matched, so `main()` never ran and the bar appeared as an empty line with no error — invisible to diagnose. The guard now compares **realpaths** (falling back to the href check if realpath fails), so a symlinked install renders correctly. Found while verifying a fresh v0.1.15 plugin install.

## [0.1.15] — 2026-05-29

### Fixed
- **An orphaned status line no longer crashes on every render after `/plugin uninstall`.** If you ran `/plugin uninstall cc-cream` without first running `/cc-cream:uninstall`, the `statusLine` entry stayed in `settings.json` while the plugin cache was deleted. The cache-glob then matched nothing, the baked command collapsed to a bare relative `src/cc-cream.js`, and Claude Code hit `MODULE_NOT_FOUND` (exit 1) on every render — and `/cc-cream:uninstall` was gone, so the only fix was hand-editing `settings.json`. The auto-update command now captures the resolved version dir in `$d` and short-circuits with `[ -z "$d" ] && exit 0`, so an orphaned status line is inert (silent, exit 0) instead of a recurring error. "Degrade, never crash." New installs/auto-wires get the guarded command; existing users pick it up on their next `/cc-cream:setup`.

## [0.1.14] — 2026-05-29

### Changed
- **The status bar now turns itself on — no manual `/cc-cream:setup` for fresh installs** (CREAM-nywsljfq). Claude Code can't let a plugin contribute the main status line natively (only `agent`/`subagentStatusLine` are plugin-settable — verified by probe), so the bar still needs a write to `settings.json`. Instead of making you run `/cc-cream:setup`, the `SessionStart` hook (`hooks/auto-setup.js`, renamed from `setup-reminder.js`) now **auto-wires** cc-cream's `statusLine` on the first session after install — but **only when no status line is configured**. It never clobbers a status line you set for something else (that still routes through the interactive `/cc-cream:setup`), and a one-shot marker means it never re-adds the bar after you remove it with `/cc-cream:uninstall`. The nudge to run `/cc-cream:setup` now appears only in the foreign-status-line case. Output stays a single `systemMessage` (zero model tokens). You may need to restart/trust the workspace for the bar to appear.

## [0.1.13] — 2026-05-29

### Fixed
- **Setup/uninstall commands showed no visible feedback** (regression from 0.1.12). Trimming the command `.md` bodies to just the bang line removed the only part Claude Code surfaces prominently — a slash command's bang (`` !`…` ``) output is folded into the model prompt, not shown to the user — so running `/cc-cream:setup` appeared to do nothing. Restored a brief one-line note to each command body (visible confirmation of what's happening), while keeping the expensive statusLine-JSON echo out of `install.js` (the real token win from 0.1.12). Net: still far cheaper than ≤0.1.11, but the command no longer looks silent.

## [0.1.12] — 2026-05-29

### Changed
- **`/cc-cream:setup` and `/cc-cream:uninstall` are much cheaper to run** (CREAM-qhgyiodh). These are slash commands, so their `.md` body and the installer's stdout both enter the model context (~1k tokens for an uninstall). Trimmed the command bodies to just the bang line — the only essential human hint (“run `/plugin uninstall cc-cream` afterwards”) now lives in the frontmatter `description`, which is menu metadata rather than model-facing body. And `install.js` no longer echoes the full statusLine command JSON: it prints terse confirmations (`Removed cc-cream's statusLine.`, `Setting the cc-cream statusLine.`). The terse summary also survives Claude Code's command-output fold, so the “what was removed / kept” feedback is actually visible. (The bar itself remains zero-token — it's never in the model context; this only concerns the occasional setup/uninstall commands.)

## [0.1.11] — 2026-05-29

### Fixed
- **Status bar could pin to an old version when a non-semver cache dir exists** (CREAM-kxwhbwzq). The plugin-mode statusLine self-resolves the highest installed version with `ls -1d …/cc-cream/*/ | sort -V | tail -1`. `sort -V` sorts directory *names*, so a git-sha install dir (e.g. `c83650b6360f/`) sorts after every `0.1.x` and got picked — pinning the bar to whatever version that dir held (observed: 0.1.3), with `/plugin update` unable to move off it. The command now filters to semver-named dirs (`grep -E '/[0-9]+(\.[0-9]+)+/$'`) before `sort -V`, so a stray non-numeric dir can't hijack version selection. Re-run `/cc-cream:setup` once (or reinstall) to rewrite the statusLine with the hardened command.

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

[0.1.18]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.14...v0.1.15
[0.1.6]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/bart-turczynski/cc-cream/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/bart-turczynski/cc-cream/releases/tag/v0.1.0
