# Architecture

Internal reference for cc-cream. For host-side plugin behavior — how the
installer, cache and updates work — see [PLUGIN-DISTRIBUTION.md](PLUGIN-DISTRIBUTION.md).
For the user-facing config schema, see [CONFIGURATION.md](CONFIGURATION.md).

## Repo layout

The plugin payload lives in a `plugin/` subdirectory (`plugin/src/`,
`plugin/commands/`, `plugin/hooks/`, `plugin/.claude-plugin/plugin.json`).
`package.json`, `pnpm-lock.yaml`, dev configs and `features/` stay at the repo
root.

The split is deliberate. Claude Code's plugin installer runs `npm install`
whenever it finds a `package.json` in the cached plugin tree, which pulled
~114 MB of devDependencies into `~/.claude/plugins/cache/`. The catalogue entry
points at `plugin/`, not the repo root, so only `plugin/`'s contents reach the
cache — and no `package.json` is there, so no install runs. The npm package
(`bin`/`files`) points at `plugin/src/`.

## Data flow

Claude Code pipes a JSON blob to stdin → `plugin/src/cc-cream.js` reads it,
loads config, reads/writes session state, calls `render()`, writes
ANSI-colored output to stdout.

## Modules

All under `plugin/src/`. Node built-ins only, ESM, no runtime deps.

| Module | Role |
| --- | --- |
| `cc-cream.js` | Entrypoint: stdin → parse → render → stdout. Orchestrates session state I/O and re-exports the other modules' public API. |
| `defaults.js` | `DEFAULTS` object, `ROW1_ZONES` zone layout, `ANSI` color codes. |
| `config.js` | Loads and merges `~/.claude/cc-cream.json` onto `DEFAULTS` via a schema-table of per-field normalizers. The same table backs `checkConfig()`, the `--check-config` doctor. |
| `render.js` | Assembles enabled and visible segments into ≤3 rows. `buildSegments()` returns the raw segment map, shared with the debug path. |
| `segments.js` | Per-segment rendering, returning `{ text, color }` or `null`. Pure — no filesystem access; the TTL anchor is injected, resolved in `cc-cream.js`. |
| `ttl.js` | TTL resolution: `resolveTtl()`, `hasWindow()`. |
| `utils.js` | `paint()`, `band()`, `countdown()`, `isPeak()`, `fmtNum()`. |
| `state.js` | Session state: `readState()` / `writeState()` to `~/.claude/cc-cream-state.json`, keyed by `session_id`. |
| `settings.js` | Shared `settings.json` I/O: a `readSettings()` classifier (`{ state, value }`), `isSafeToWrite()`, atomic `writeFileAtomic()`. Used by both the installer and the SessionStart hook, so the destructive-write guard lives once. |
| `install.js` | Consent-based installer: a pure `plan()` plus a thin I/O shell. Writes a `statusLine` block into `~/.claude/settings.json`. Shipped to npm users as the `cc-cream-setup` bin (`--uninstall` / `--purge` / `--check-config`); the `cc-cream` bin is the renderer. |
| `paths.js` | Single `PATHS` table of every `~/.claude/*` location — config, state, debug log, settings, runtime dir and entry — resolved lazily via `os.homedir()`. Import these rather than re-deriving a path. |
| `plugin-cache.js` | Locates cc-cream inside the plugin host. `pluginCacheLocation()` splits a running path at `plugins/cache/<marketplace>/<plugin>/`; `findPluginInstalls()` / `findPluginDataDirs()` enumerate every marketplace it is cached under. |
| `orphan.js` | `isOrphanedPluginRun()` detects a renderer executing from a stale cache location no longer in the registry — the ghost-bar trap. The entrypoint then exits 0 silently. Backs feature 32. |

The `<marketplace>` path segment is the host's to name and has been renamed
once (`cc-cream` → `bart-turczynski`). Never spell it out in a path — derive it
through `plugin-cache.js`, or the uninstall instructions and `--status` go
quietly wrong (CREAM-axtbxevj).

Session state must be keyed by `session_id`. Skip state I/O entirely when
`session_id` is absent.

## Segments

Sixteen segments, all configurable via `~/.claude/cc-cream.json`. `ROW1_ZONES`
in `defaults.js` is the canonical row-1 layout.

- **Row 1** — `ctx`, `cache`, `write`, `ttl`, `api_ratio`, `tokens_in`, `tokens_out`, `cost`
- **Row 2** — `5h`, `7d`, `burn`, `peak`. Hidden entirely for API users, who have no `rate_limits` in stdin.
- **Row 3** — `model`, `session_name`, `effort`, `thinking`

Config drives every display decision — on/row/order/thresholds/colors — with
per-field and whole-file fallback. There is no `width` key and no UI.

Minimum Claude Code is 2.1.132. `effort` and `thinking` additionally need
2.1.145 and stay hidden below it.

## Diagnostics

`CC_CREAM_DEBUG=1` appends a per-render diagnostic to
`~/.claude/cc-cream-debug.log` — which on-by-config segments rendered versus
were dropped, the TTL window, stdin size. Override the path with
`CC_CREAM_DEBUG_LOG`. Off by default.

stdout is never touched. Claude Code discards status-line stderr, so a file is
the only viable channel.

## Plugin surface

`plugin/.claude-plugin/plugin.json` is the Claude Code manifest — name, version,
author. It does **not** declare `commands`.

Command files must live in a `commands/` directory at the plugin root, i.e.
`plugin/commands/`, sibling of `plugin/.claude-plugin/` — and the `commands`
key in `plugin.json` must be omitted so Claude Code auto-discovers them. The
install-time schema rejects an array of file paths (`commands: Invalid input`)
even though `claude plugin validate`, which is more lenient, accepts it. This
matches the official `ralph-loop` layout. Command files reference
`${CLAUDE_PLUGIN_ROOT}/src/...`, so their own location is otherwise irrelevant.

- `plugin/commands/setup.md` registers `/cc-cream:setup` and invokes
  `src/install.js` in plugin mode. The wired `statusLine` command is a plain
  absolute path to the current version's `cc-cream.js`
  (`[ -f "<ep>" ] || exit 0; exec "<node>" "<ep>"`) — not a cache-glob.
  `${CLAUDE_PLUGIN_ROOT}` does not expand in the statusLine context, so the
  version cannot be resolved at render time.
- `plugin/commands/uninstall.md` registers `/cc-cream:uninstall`.

### The SessionStart hook

`plugin/hooks/hooks.json` + `plugin/hooks/auto-setup.js`, auto-discovered with
no `hooks` key in `plugin.json`. It does two jobs.

1. **Creation.** Auto-wires cc-cream's `statusLine` on the first session after
   install, but only when the slot is free — it never clobbers a foreign line,
   which routes through interactive `/cc-cream:setup` instead. A one-shot
   marker (`$CLAUDE_PLUGIN_DATA/cc-cream-autowire-done`, falling back to the
   config dir) gates creation, so it never re-wires a bar the user removed.
2. **Keep-fresh.** An *existing* cc-cream line is re-pinned to the current
   version's path every session, not marker-gated, so `/plugin update` is
   applied silently.

It reuses `install.js`'s `plan()` and resolves the entrypoint from
`${CLAUDE_PLUGIN_ROOT}`, which it does receive. A foreign statusLine produces a
`systemMessage` pointing at `/cc-cream:setup`. Output is a single
`systemMessage` — user-facing, zero model tokens.

The hook exists because a plugin-native statusLine is not possible: only
`agent` and `subagentStatusLine` are plugin-settable. Plugin-only; npm and
manual users run `cc-cream-setup`.

## Distribution

There is no `marketplace.json` in this repo. `dbf9cc1` moved the listing to a
separate lean catalogue repo, `gitlab.com/bart-turczynski/claude-plugins`, so
registering the marketplace clones ~136 KB of plugin payload rather than this
whole dev repo. Its `cc-cream/` directory is a generated mirror of `plugin/`,
written by the `sync-catalogue` job in `.gitlab-ci.yml` on each version tag —
edit `plugin/` here, never the catalogue. Install is
`/plugin marketplace add https://gitlab.com/bart-turczynski/claude-plugins.git`,
a `url` git source; the `owner/repo` shorthand is GitHub-only.

## Tests

- `features/NN-*.feature` — one Gherkin file per slice, 00 through 38. The
  feature file is the acceptance spec.
- `features/step_definitions/steps.js` — all step definitions.
- `features/support/world.js` — custom world: sandbox HOME setup, a `run()`
  helper that spawns the engine, `makeTranscript()`, ANSI color helpers.
- `fixtures/*.golden.json` — live-captured stdin samples, subscriber 1M and
  200k, used as BDD inputs.

Profiles are declared in `cucumber.json`. The default is
`not @manual and not @needs-cli`, so the gate is CI-safe by construction.
`@manual` covers the release runbook in `features/25-*.feature` — a checklist a
human walks by hand, with no runner and no step definitions, because its steps
end in a web form, npm's indexing and Anthropic's review. `@needs-cli` covers
anything shelling out to a live `claude`, including the `--strict` pre-submission
pass (`pnpm run test:cli`). An untagged scenario that shells out to a
missing CLI would silently break `npm publish` — CREAM-xzhidmjt.

Beyond the `package.json` scripts:

```bash
pnpm exec cucumber-js features/03-context-segment.feature  # one feature file
pnpm exec cucumber-js --name "some scenario title"         # match by name
pnpm pack --dry-run                                        # verify tarball contents
```

## CI

`.gitlab-ci.yml` runs the exact publish gate — `pnpm test` — on every MR and
push to `main`, across a Node 22/24 matrix (`parallel: matrix`), on a runner
with no `claude` CLI. The job asserts the CLI is absent, mirroring the publish
environment.

`pnpm run coverage` wraps the suite in c8 and enforces `--lines 90`; only lines
is gated, the other three c8 metrics default to 0. The pre-push hook
(simple-git-hooks, registered once with `pnpm run hooks`) runs it. Skip with
`SKIP_SIMPLE_GIT_HOOKS=1 git push`.

`--strict` plugin validation is reserved for the pre-submission pass in
`pnpm run test:cli`, not the default gate.

## Spec

`docs/PRD.md` and `docs/PRDv2.md` hold the full spec, v2 plus §14 decisions,
which supersede any conflicting earlier prose. `docs/` is gitignored as
internal working material, so neither is in a fresh clone.
