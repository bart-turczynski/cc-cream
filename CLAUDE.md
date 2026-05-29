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
npx cucumber-js features/03-context-segment.feature # run a single feature file
npx cucumber-js --name "some scenario title"        # run matching scenarios by name
npm pack --dry-run                                   # verify published tarball contents
```

## Source of truth (read before working)
- `docs/PRD.md` and `docs/PRDv2.md` — full spec (v2 + **§14 decisions, which supersede any conflicting earlier prose**).
- `features/NN-*.feature` — Gherkin user stories, one per slice (00–25, 26 files). The feature file IS the acceptance spec. Scenarios tagged `@manual` are not run in CI (use `npm run test:manual`).
- FP epic `CREAM-lwiwezhg` — the backlog. `fp tree` for deps / build order.

## Architecture

Data flow: Claude Code pipes a JSON blob to stdin → `src/cc-cream.js` reads it, loads config, reads/writes session state, calls `render()`, writes ANSI-colored output to stdout.

Key source modules (all Node built-ins only, ESM, no runtime deps):
- `src/cc-cream.js` — entrypoint: stdin → parse → render → stdout; also orchestrates session state I/O. Re-exports the public API of the other modules.
- `src/defaults.js` — `DEFAULTS` object, `ROW1_ZONES` zone layout, `ANSI` color codes.
- `src/config.js` — loads and deep-merges `~/.claude/cc-cream.json` onto `DEFAULTS`.
- `src/render.js` — assembles enabled/visible segments into ≤3 rows.
- `src/segments.js` — per-segment rendering logic (returns `{ text, color }` or `null`).
- `src/ttl.js` — TTL resolution (`resolveTtl()`, `hasWindow()`).
- `src/utils.js` — `paint()`, `band()`, `countdown()`, `isPeak()`, `fmtNum()`, etc.
- `src/state.js` — session state: `readState()` / `writeState()` to `~/.claude/cc-cream-state.json`, keyed by `session_id`.
- `src/install.js` — consent-based installer; pure `plan()` function plus thin I/O shell. Writes a `statusLine` block into `~/.claude/settings.json`.

Plugin distribution layer:
- `.claude-plugin/plugin.json` — Claude Code plugin manifest (name, version, commands, author).
- `.claude-plugin/marketplace.json` — self-hosted marketplace listing.
- `.claude-plugin/commands/setup.md` — registers `/cc-cream:setup`; invokes `src/install.js` in plugin mode and writes a cache-glob `statusLine` command so `/plugin update` auto-updates without re-running setup.
- `.claude-plugin/commands/uninstall.md` — registers `/cc-cream:uninstall`.
- Command files **must** live inside `.claude-plugin/commands/` — the plugin validator resolves `commands` paths in `plugin.json` relative to `.claude-plugin/`, and rejects `..` path traversal.

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
- **Biome** — lints `src/` on every `npm test` (pretest hook). Rules: `noCommonJs` + `noUndeclaredDependencies` as errors, recommended rules as warnings.
- **knip** — dead-code / unused-export audit, also runs in pretest. Config: `knip.json`.
- **validate** — `claude plugin validate .` runs in pretest; skips gracefully when the `claude` CLI is absent. `--strict` (warnings-as-errors) is reserved for `npm run test:manual` pre-submission only.
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
