# cc-cream

@FP_AGENTS.md

Node status-line tool for Claude Code: reads Claude Code's stdin JSON, prints a
colored ≤3-row bar. Zero tokens — the model never sees the output.

A *segment* is one field on the bar. A *slice* is one `features/NN-*.feature`
and its 1:1 fp issue; the feature file is the acceptance spec. Gate done on
`pnpm test`.

No runtime dependencies. Node built-ins only, ESM.

Degrade, never crash: malformed stdin, config or state exits 0 and hides the
segment.

`plugin/` carries no `package.json` on purpose — the plugin host runs
`npm install` on any in its cache.

The marketplace listing is a separate catalogue repo whose `cc-cream/`
directory CI generates from `plugin/`. Edit `plugin/`. No root
`marketplace.json`.

Tag `@needs-cli` on any scenario that shells out to a live `claude`. The
publish runner has none.

`docs/` is gitignored, so `docs/PRD.md` and `docs/PRDv2.md` — the spec — are
absent from a fresh clone.

For module layout, data flow and diagnostics, see ARCHITECTURE.md.
For config keys and the segment catalog, see CONFIGURATION.md.
For plugin host, install and update mechanics, see PLUGIN-DISTRIBUTION.md.
For release setup and CI publishing, see RELEASING.md.
For dev commands and the contribution flow, see CONTRIBUTING.md.
