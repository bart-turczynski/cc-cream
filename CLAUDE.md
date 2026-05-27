@FP_CLAUDE.md

# cc-cream — agent guide

Single-file Node status-line tool for Claude Code: reads CC's stdin JSON, prints a colored ≤2-row bar (`model · ctx · cache · idle · cost` / `5h · 7d`). Zero tokens — the model never sees the output.

## Source of truth (read before working)
- `docs/PRD.md` — full spec (v2 + **§14 decisions, which supersede any conflicting earlier prose**).
- `features/NN-*.feature` — Gherkin user stories, one per vertical slice S0–S10. The feature file IS the acceptance spec.
- FP epic `CREAM-lwiwezhg` (children S0–S10) — the backlog. `fp tree` for deps / build order.

## Per-slice workflow (extends @FP_CLAUDE.md)
- features ↔ FP issues are **1:1**; pick a slice, implement against its `.feature`.
- Build order: **S0 first (gating)** → S1 → S2; S3 gated on S0; S4–S8 on S2; S9 on S1; S10 on S9.
- Engine code in `src/`, step defs in `features/step_definitions/`. Gate "done" on `npm test` (cucumber-js) green.

## Hard constraints
- Engine = **one `.js` file, Node built-ins only, no runtime deps, ESM**. Cucumber is dev-only.
- **Degrade, never crash:** malformed/empty stdin or config → exit 0, hide the segment, per-field fallback to defaults.
- Config `~/.claude/cc-cream.json` drives every display decision (on/row/order/thresholds/colors); per-field + whole-file fallback. **No `width` key** (dropped §14.2). No UI.
- v1 ships **raw `.js` on GitHub only** (npm + plugin → v2). Min CC **2.1.132**.
- Stateless in v1; any future state MUST be keyed by `session_id`.
