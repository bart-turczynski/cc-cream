# cc-cream Code Review Improvement Ideas

## Context

This review treats cc-cream as a one-user plugin, so backward compatibility is not
a constraint. Prefer systemic simplification and breaking changes when they make
the architecture cleaner, safer, or easier to reason about.

The current suite is healthy: `npm test` passed with 218 scenarios and 952 steps.
There is one low-priority maintenance warning from `knip`: `src/install.js` is a
redundant entry pattern in `knip.json`.

## Highest-Value Changes

1. Replace the shell-based plugin cache resolver.

   `src/install.js` currently writes a statusLine command that resolves the
   newest plugin cache entry through `ls | grep -E | sort -V | tail -1`. This is
   the clearest hack in the codebase: it bakes filesystem traversal, semver
   filtering, ordering, missing-cache behavior, and command execution into one
   shell string.

   Replace it with a small Node resolver entrypoint that:

   - Reads the plugin cache directory with `fs.readdirSync`.
   - Parses candidate versions with a real semver parser or a tiny structured
     semver function that returns `{ major, minor, patch }`.
   - Ignores non-version directories without shelling out to `grep`.
   - Selects the highest version by numeric comparison.
   - Exits 0 with no output when no runnable cached version exists.
   - Executes the resolved `src/cc-cream.js` through `process.execPath` or
     `spawnSync`/`spawn` with explicit stdio forwarding.

   Since compatibility does not matter, remove the old cache-glob command
   entirely instead of maintaining both strategies.

2. Split installer responsibilities into internal services.

   `src/install.js` mixes command construction, settings parsing, install
   planning, runtime copying, prompting, uninstall cleanup, filesystem writes,
   stdout/stderr, and process exits. Split it by use case:

   - `settings-store`: read, validate, and atomically write Claude settings.
   - `statusline-planner`: pure install/uninstall plans.
   - `command-factory`: statusLine command construction and cc-cream ownership.
   - `runtime-copy-service`: manual install file discovery and copy decisions.
   - `installer-cli`: argument parsing, prompts, messages, and exit codes.
   - `auto-setup-controller`: SessionStart hook behavior.

   The hook in `hooks/auto-setup.js` should reuse `settings-store`,
   `statusline-planner`, and `command-factory` directly. It should not carry its
   own settings parser.

3. Build a structured render model before formatting text.

   The render path is already more cohesive than the installer, but
   `src/segments.js` still combines domain extraction, calculations, coloring,
   and presentation strings in one module. Introduce a structured render model:

   - Metric services calculate facts: context usage, cache read/write rates,
     TTL freshness, rate-limit reset state, burn projection.
   - Segment builders map metrics to `{ id, row, zone, order, label, value,
     color }`.
   - The final renderer is only responsible for ordering, separators, ANSI
     coloring, and line joining.

   This would let tests assert structured segment objects instead of parsing
   terminal output.

4. Replace regex-heavy tests with parser/model assertions.

   Several Cucumber steps parse rendered rows with regexes and string slicing,
   especially around rate-limit countdowns and statusLine command shape. These
   tests are brittle because they validate implementation text instead of
   behavior.

   After introducing a render model and Node cache resolver, update tests to:

   - Assert the selected plugin version by calling the resolver with fixture
     directories.
   - Assert rate-limit segments from structured render objects.
   - Keep regex tests only where regex is the actual behavior under test, such
     as stripping terminal control characters.

5. Make config normalization schema-driven.

   `src/config.js` currently validates each field with ad hoc conditionals.
   Replace that with a small schema table describing allowed segment keys,
   normalizers, defaults, and value domains. Keep the current forgiving behavior:
   invalid fields fall back to defaults.

   This makes new segment options cheaper to add and prevents validation rules
   from being scattered across the file.

## Service Boundaries to Aim For

Favor microservice-style boundaries inside the local process rather than
networked services. Networked microservices would undermine the plugin's core
properties: no network calls, no telemetry, low latency, and reliable rendering
inside Claude Code's status-line path.

Suggested internal service map:

- `session-input-service`: parse stdin and normalize Claude Code's session JSON.
- `config-service`: load and normalize `~/.claude/cc-cream.json`.
- `state-service`: read, patch, prune, and atomically write session state.
- `metrics-service`: calculate token, cache, TTL, rate-limit, and cost metrics.
- `segment-service`: convert metrics into segment objects.
- `render-service`: convert segment objects to terminal-safe rows.
- `settings-service`: manage `settings.json`.
- `plugin-cache-service`: resolve installed plugin cache versions.
- `install-service`: orchestrate install/uninstall use cases.
- `hook-service`: orchestrate SessionStart auto-setup.

Each function should serve one use case. If a function both decides policy and
performs I/O, split it.

## Specific Findings

- `src/install.js` line 40 embeds cache discovery, semver filtering, sorting,
  fallback, and execution in one shell command. Replace with `plugin-cache-service`.
- `src/install.js` line 60 identifies cc-cream ownership with
  `command.includes('cc-cream')`. Replace with structured command metadata where
  possible, or at least a command parser tied to the new command format.
- `src/install.js` line 167 reads settings and exits the process directly.
  Return typed errors from the settings layer and let the CLI decide exit codes.
- `src/install.js` line 214 shells out to `command -v node`. Prefer
  `process.execPath` if the new resolver runs under Node and can re-exec itself.
- `hooks/auto-setup.js` line 38 duplicates settings parsing logic from the
  installer. Share a settings service.
- `src/segments.js` line 59 performs TTL anchor resolution and filesystem
  `statSync` inside segment rendering. Move TTL freshness calculation out of
  presentation.
- `src/segments.js` line 161 returns already-renderable segment text. Return
  structured segment data first, then format later.
- `features/step_definitions/steps.js` line 27 parses duration phrases with a
  test-local regex. Replace with explicit test fixtures or a small duration
  parser helper shared by tests.
- `features/step_definitions/steps.js` line 343 parses status output with a
  regex. Assert structured render output instead.
- `features/step_definitions/steps.js` line 1267 validates the exact `grep`
  regex in the generated command. Delete this once cache resolution is a Node
  service.

## Suggested Implementation Order

1. Extract settings read/write and install planning from `src/install.js`, with
   no behavior change.
2. Introduce the Node plugin-cache resolver and delete the shell cache-glob
   strategy.
3. Update setup/autowire commands to call the new resolver path.
4. Refactor render into metrics, segment model, and formatter layers.
5. Replace brittle output parsing tests with structured model tests.
6. Convert config normalization to a schema table.
7. Clean `knip.json` and update docs to describe the new architecture.

## Acceptance Criteria

- `npm test` passes.
- Plugin cache selection is tested without invoking `sh`, `grep`, `sort`, or
  `tail`.
- Auto-setup and CLI install share one settings parser.
- Segment tests can assert structured segment objects before ANSI formatting.
- No runtime network calls or telemetry are introduced.
- Functions that currently mix policy and I/O are split into single-use
  functions or modules.
