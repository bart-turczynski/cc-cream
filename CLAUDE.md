# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@FP_CLAUDE.md

# cc-cream — agent guide

Node status-line tool for Claude Code: reads CC's stdin JSON, prints a colored ≤3-row bar. Zero tokens — the model never sees the output.

## Commands

```bash
npm install                                          # install cucumber-js (dev-only)
npm test                                             # run all Cucumber specs
npx cucumber-js features/03-context-segment.feature # run a single feature file
npx cucumber-js --name "some scenario title"        # run matching scenarios by name
```

## Source of truth (read before working)
- `docs/PRD.md` and `docs/PRDv2.md` — full spec (v2 + **§14 decisions, which supersede any conflicting earlier prose**).
- `features/NN-*.feature` — Gherkin user stories, one per slice (00–18). The feature file IS the acceptance spec.
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

Test infrastructure:
- `features/step_definitions/steps.js` — all Cucumber step definitions.
- `features/support/world.js` — custom world: sandbox HOME setup, `run()` helper to spawn the engine, `makeTranscript()`, ANSI color helpers.
- `fixtures/*.golden.json` — live-captured stdin samples (subscriber 1M + 200k); used as BDD test inputs.

Thirteen segments (all configurable via `~/.claude/cc-cream.json`):
- Row 1 — `ctx`, `cache`, `write`, `ttl`, `effort`, `thinking`, `api_ratio`, `cost`
- Row 2 — `5h`, `7d`, `burn`, `peak` (hidden entirely for API users — no `rate_limits` in stdin)
- Row 3 — `model`, `session_name`

## Per-slice workflow (extends @FP_CLAUDE.md)
- features ↔ FP issues are **1:1**; pick a slice, implement against its `.feature`.
- Engine code in `src/`, step defs in `features/step_definitions/`. Gate "done" on `npm test` (cucumber-js) green.

## Hard constraints
- **No runtime deps, ESM** — Cucumber is dev-only. Node built-ins only across all `src/` modules.
- **Degrade, never crash:** malformed/empty stdin or config → exit 0, hide the segment, per-field fallback to defaults.
- Config `~/.claude/cc-cream.json` drives every display decision (on/row/order/thresholds/colors); per-field + whole-file fallback. **No `width` key** (dropped §14.2). No UI.
- Min CC **2.1.132**. `effort`/`thinking` additionally need 2.1.145 and stay hidden below it.
- Session state MUST be keyed by `session_id`; skip state I/O when `session_id` is absent.
