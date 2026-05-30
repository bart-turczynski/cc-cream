# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@FP_CLAUDE.md

# cc-cream — agent guide

Node status-line tool for Claude Code: reads CC's stdin JSON, prints a colored ≤3-row bar. Zero tokens — the model never sees the output.

## Commands

```bash
npm install                                          # install devDeps
npm run hooks                                        # one-time: register the pre-push git hook
npm test                                             # lint + knip + plugin validate + all Cucumber specs
npm run coverage                                     # same but wrapped in c8 (coverage table)
npm run watch                                        # re-run specs on file change (TDD)
npm run lint                                         # Biome lint on src/ only
npm run knip                                         # dead-code / unused-export audit
npm run validate                                     # claude plugin validate . (skips if claude CLI absent)
npm run test:manual                                  # run @manual scenarios (release runbook, --strict validation)
npm run test:cli                                      # run @needs-cli scenarios (shell out to a live `claude` — needs the CLI)
npx cucumber-js features/03-context-segment.feature # run a single feature file
npx cucumber-js --name "some scenario title"        # run matching scenarios by name
npm pack --dry-run                                   # verify published tarball contents
```

## Source of truth (read before working)
- `docs/PRD.md` and `docs/PRDv2.md` — full spec (v2 + **§14 decisions, which supersede any conflicting earlier prose**). Kept **locally only** — `docs/` is gitignored (internal working material), so these won't be in a fresh clone.
- `features/NN-*.feature` — Gherkin user stories, one per slice (00–31). The feature file IS the acceptance spec. Scenarios tagged `@manual` are not run in CI (use `npm run test:manual`). Scenarios that shell out to a host CLI (e.g. a live `claude`) **must** be tagged `@needs-cli` — they're excluded from the default profile so they can't break `npm publish` on a CLI-less runner; run them with `npm run test:cli`.
- FP epic `CREAM-lwiwezhg` — the backlog. `fp tree` for deps / build order.

## Architecture

Data flow: Claude Code pipes a JSON blob to stdin → `src/cc-cream.js` reads it, loads config, reads/writes session state, calls `render()`, writes ANSI-colored output to stdout.

Key source modules (all Node built-ins only, ESM, no runtime deps):
- `src/cc-cream.js` — entrypoint: stdin → parse → render → stdout; also orchestrates session state I/O. Re-exports the public API of the other modules.
- `src/defaults.js` — `DEFAULTS` object, `ROW1_ZONES` zone layout, `ANSI` color codes.
- `src/config.js` — loads and merges `~/.claude/cc-cream.json` onto `DEFAULTS` via a **schema-table** of per-field normalizers; the same table backs `checkConfig()` (the `--check-config` doctor).
- `src/render.js` — assembles enabled/visible segments into ≤3 rows. `buildSegments()` returns the raw segment map (shared with the debug path).
- `src/segments.js` — per-segment rendering logic (returns `{ text, color }` or `null`). **Pure** — no filesystem access; the TTL anchor is injected (resolved in `cc-cream.js`).
- `src/ttl.js` — TTL resolution (`resolveTtl()`, `hasWindow()`).
- `src/utils.js` — `paint()`, `band()`, `countdown()`, `isPeak()`, `fmtNum()`, etc.
- `src/state.js` — session state: `readState()` / `writeState()` to `~/.claude/cc-cream-state.json`, keyed by `session_id`.
- `src/settings.js` — shared `settings.json` I/O: a `readSettings()` classifier (`{ state, value }`), `isSafeToWrite()`, and atomic `writeFileAtomic()`. Used by both the installer and the SessionStart hook so the destructive-write guard lives once.
- `src/install.js` — consent-based installer; pure `plan()` function plus thin I/O shell. Writes a `statusLine` block into `~/.claude/settings.json`. Exposed to npm users as the `cc-cream-setup` bin (`cc-cream-setup` / `--uninstall` / `--purge` / `--check-config`); the `cc-cream` bin is the renderer (`src/cc-cream.js`).

Diagnostics: `CC_CREAM_DEBUG=1` makes the engine append a per-render diagnostic (which on-by-config segments rendered vs were dropped, ttl window, stdin size) to `~/.claude/cc-cream-debug.log` (override: `CC_CREAM_DEBUG_LOG`). **stdout is never touched** — Claude Code discards status-line stderr, so a file is the only viable channel. Off by default.

Plugin distribution layer:
- `.claude-plugin/plugin.json` — Claude Code plugin manifest (name, version, author). **Does not** declare `commands`.
- `.claude-plugin/marketplace.json` — self-hosted marketplace listing.
- `commands/setup.md` — registers `/cc-cream:setup`; invokes `src/install.js` in plugin mode. The wired `statusLine` command is a plain absolute path to the current version's `cc-cream.js` (`[ -f "<ep>" ] || exit 0; exec "<node>" "<ep>"`) — **not** a cache-glob. `${CLAUDE_PLUGIN_ROOT}` doesn't expand in the statusLine context, so the version can't be resolved at render time; the SessionStart hook (which *does* get it) re-pins the path after `/plugin update`.
- `commands/uninstall.md` — registers `/cc-cream:uninstall`.
- `hooks/hooks.json` + `hooks/auto-setup.js` — a `SessionStart` hook (auto-discovered, no `hooks` key in `plugin.json`, like `ralph-loop`) that does two jobs. (1) **Creation:** auto-wires cc-cream's `statusLine` on the first session after install, but **only when the slot is free** — never clobbers a foreign line (that routes through interactive `/cc-cream:setup`). A one-shot marker (`$CLAUDE_PLUGIN_DATA/cc-cream-autowire-done`, falling back to the config dir) gates creation so it never re-wires a bar the user removed. (2) **Keep-fresh:** an *existing* cc-cream line is re-pinned to the current version's path every session (NOT marker-gated), so `/plugin update` is applied silently. It reuses `install.js`'s `plan()` and resolves the entrypoint from `${CLAUDE_PLUGIN_ROOT}`. Foreign-statusLine case → a `systemMessage` pointing to `/cc-cream:setup`. Output is a single `systemMessage` — user-facing, **zero model tokens**. Plugin-native statusLine isn't possible (only `agent`/`subagentStatusLine` are plugin-settable), which is why this hook exists. Plugin-only; npm/manual users run `cc-cream-setup`.
- Command files **must** live in a top-level `commands/` directory (plugin root, sibling of `.claude-plugin/`), and the `commands` key in `plugin.json` **must be omitted** so Claude Code auto-discovers them. The install-time schema rejects an array of file paths (`commands: Invalid input`) even though `claude plugin validate` — which is more lenient — accepts it. This matches the official `ralph-loop` plugin layout. Command files reference `${CLAUDE_PLUGIN_ROOT}/src/...`, so their own location is otherwise irrelevant.

Test infrastructure:
- `features/step_definitions/steps.js` — all Cucumber step definitions.
- `features/support/world.js` — custom world: sandbox HOME setup, `run()` helper to spawn the engine, `makeTranscript()`, ANSI color helpers.
- `fixtures/*.golden.json` — live-captured stdin samples (subscriber 1M + 200k); used as BDD test inputs.

Fourteen segments (all configurable via `~/.claude/cc-cream.json`):
- Row 1 — `ctx`, `cache`, `write`, `ttl`, `effort`, `thinking`, `api_ratio`, `cost`
- Row 2 — `5h`, `7d`, `burn`, `peak` (hidden entirely for API users — no `rate_limits` in stdin)
- Row 3 — `model`, `session_name`

## Per-slice workflow (extends @FP_CLAUDE.md)
- features ↔ FP issues are **1:1**; pick a slice, implement against its `.feature`.
- Engine code in `src/`, step defs in `features/step_definitions/`. Gate "done" on `npm test` (cucumber-js) green.

## Dev tooling
- **Biome** — lints `src/` and `hooks/` on every `npm test` (pretest hook). Rules: `noCommonJs` + `noUndeclaredDependencies` as errors, recommended rules as warnings.
- **knip** — dead-code / unused-export audit, also runs in pretest. Config: `knip.json`.
- **validate** — `claude plugin validate .` runs in pretest; skips gracefully when the `claude` CLI is absent. `--strict` (warnings-as-errors) is reserved for `npm run test:manual` pre-submission only.
- **CI** — `.github/workflows/ci.yml` runs the exact publish gate (`npm test`) on every PR + push to `main`, on a runner with **no `claude` CLI** (it asserts the CLI is absent, mirroring the npm-publish environment). This is the guard for CREAM-xzhidmjt: any `@needs-cli`-untagged scenario that shells out to a missing CLI fails here, at review time, instead of silently breaking `npm publish`. The default cucumber profile is `not @manual and not @needs-cli`, so the gate is CI-safe by construction.
- **c8** — V8 coverage via `npm run coverage`. Current baseline: ~94% statements across `src/`.
- **simple-git-hooks** — pre-push hook runs `npm run coverage`; register it once with `npm run hooks` (kept off the `prepare` lifecycle so the published package ships no install-time scripts). Skip with `SKIP_SIMPLE_GIT_HOOKS=1 git push`.

## Releasing

See `RELEASING.md` for the full runbook. npm publishes via **OIDC trusted publishing** (no tokens) triggered by a GitHub Release on `main`. Key steps: update `CHANGELOG.md` → `npm version patch|minor|major` → `git push --follow-tags` → `gh release create vX.Y.Z`. The `prepublishOnly` hook runs the full test suite before publish.

## Hard constraints
- **No runtime deps, ESM** — Cucumber is dev-only. Node built-ins only across all `src/` modules.
- **Degrade, never crash:** malformed/empty stdin or config → exit 0, hide the segment, per-field fallback to defaults.
- Config `~/.claude/cc-cream.json` drives every display decision (on/row/order/thresholds/colors); per-field + whole-file fallback. **No `width` key** (dropped §14.2). No UI.
- Min CC **2.1.132**. `effort`/`thinking` additionally need 2.1.145 and stay hidden below it.
- Session state MUST be keyed by `session_id`; skip state I/O when `session_id` is absent.
