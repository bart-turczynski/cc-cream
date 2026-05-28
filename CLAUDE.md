# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@FP_CLAUDE.md

# cc-cream — agent guide

Single-file Node status-line tool for Claude Code: reads CC's stdin JSON, prints a colored ≤2-row bar (`model · ctx · cache · idle · cost` / `5h · 7d`). Zero tokens — the model never sees the output.

## Commands

```bash
npm install                                          # install cucumber-js (dev-only)
npm test                                             # run all Cucumber specs
npx cucumber-js features/03-context-segment.feature # run a single feature file
npx cucumber-js --name "some scenario title"        # run matching scenarios by name
```

## Source of truth (read before working)
- `docs/PRD.md` and `docs/PRDv2.md` — full spec (v2 + **§14 decisions, which supersede any conflicting earlier prose**).
- `features/NN-*.feature` — Gherkin user stories, one per vertical slice S0–S13. The feature file IS the acceptance spec.
- FP epic `CREAM-lwiwezhg` (children S0–S13) — the backlog. `fp tree` for deps / build order.

## Architecture

Data flow: Claude Code pipes a JSON blob to stdin → `src/cc-cream.js` reads it, merges config from `~/.claude/cc-cream.json`, writes ANSI-colored output to stdout.

Key files:
- `src/cc-cream.js` — entire engine (one file, Node built-ins only). Exports `render()`, `loadConfig()`, `resolveTtl()`, `isPeak()`.
- `src/install.js` — consent-based installer; pure `plan()` function plus a thin I/O shell. Writes a `statusLine` block into `~/.claude/settings.json`.
- `features/step_definitions/steps.js` — all Cucumber step definitions.
- `features/support/world.js` — custom world: sandbox HOME setup, `run()` helper to spawn the engine, `makeTranscript()`, ANSI color helpers.
- `fixtures/*.golden.json` — live-captured stdin samples (subscriber 1M + 200k); used as BDD test inputs.

Nine segments (all configurable): Row 1 — `model`, `ctx`, `cache`, `idle`, `cost`, `effort`, `thinking`; Row 2 — `5h`, `7d`, `peak`. Row 2 is hidden entirely for API users (no `rate_limits` in stdin).

## Per-slice workflow (extends @FP_CLAUDE.md)
- features ↔ FP issues are **1:1**; pick a slice, implement against its `.feature`.
- Build order: **S0 first (gating)** → S1 → S2; S3 gated on S0; S4–S8 on S2; S9 on S1; S10 on S9; S11–S13 (v2, independent of S9/S10).
- Engine code in `src/`, step defs in `features/step_definitions/`. Gate "done" on `npm test` (cucumber-js) green.

## Hard constraints
- Engine = **one `.js` file, Node built-ins only, no runtime deps, ESM**. Cucumber is dev-only.
- **Degrade, never crash:** malformed/empty stdin or config → exit 0, hide the segment, per-field fallback to defaults.
- Config `~/.claude/cc-cream.json` drives every display decision (on/row/order/thresholds/colors); per-field + whole-file fallback. **No `width` key** (dropped §14.2). No UI.
- v1 ships **raw `.js` on GitHub only** (npm + plugin → v2). Min CC **2.1.132**.
- Stateless in v1; any future state MUST be keyed by `session_id`.
