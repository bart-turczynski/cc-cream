# cc-cream Code Review Improvement Ideas — v2

> Supersedes `code-review-improvement-ideas.md`. The original is kept for
> reference; this version corrects its premise, re-scopes the proposed work, and
> adds the properties that actually separate a good status-line plugin from a
> world-class one.

## Premise

cc-cream currently has exactly one user (the author). It is published on npm and
listed in a self-hosted marketplace, but distribution is effectively zero, so
**breaking changes are free**: there is no install base to migrate, no config or
state schema to keep stable, and no need to preserve the existing `statusLine`
command format. Prefer the cleanest design outright; do not carry compatibility
shims or dual strategies "just in case."

This project is also a deliberate learning sandbox — the author's first Claude
Code plugin. "World-class" therefore has two axes:

1. **Engineering quality** of the renderer/installer internals.
2. **Reference value** as an exemplary Claude Code plugin: the idiomatic
   patterns (consent-based install, the `SessionStart` autowire hook that works
   around statusLine not being plugin-settable, the marketplace listing) should
   be polished and documented as showcase pieces, not just refactored.

The current suite is healthy: `npm test` passes (218 scenarios, 952 steps). The
only standing maintenance note is a low-priority `knip` warning that
`src/install.js` is a redundant entry in `knip.json`.

## What "free to break" lets us delete

Because no old installs need reconciling, several existing mechanisms become
pure dead weight and should be removed rather than refactored:

- The **dual command strategy** in `plan()` (`src/install.js:96-133`): manual
  `node <entrypoint>` vs the plugin cache-glob. Pick one command format and
  delete the other path entirely.
- The **"is this an older/other-strategy cc-cream line" reconciliation** used to
  decide non-interactive replacement (`src/install.js:331`). With one format,
  ownership detection collapses to a single check.
- Any thought of **config/state schema versioning or migration tooling** — not
  worth building for a sandbox of one. If a shape changes, just change it.

## Re-scoped Changes

### 1. Replace the shell cache resolver — in-process, not a second spawn

The shell one-liner (`src/install.js:39-41`,
`ls -1d … | grep -E … | sort -V | tail -1`) is the right thing to kill. The
strongest reason is correctness, not aesthetics: **`sort -V` is a GNU-ism**. The
status line runs as a detached subprocess with an unknown environment, and
macOS's `/usr/bin/sort` only gained `-V` relatively recently — version selection
can silently break or mis-order.

Two hard constraints, **verified against Claude Code docs** (statusline.md,
plugins-reference.md), that bound the design:

- **`${CLAUDE_PLUGIN_ROOT}` is NOT available in the user-level statusLine
  command.** It expands in hook / MCP / command contexts, but not in the
  `statusLine.command` string written to `~/.claude/settings.json`. That is
  exactly why the current command globs the cache dir at runtime. So the
  resolver cannot live "inside `cc-cream.js`" — the command must locate the
  right `cc-cream.js` *before* it can run, and the entrypoint can't locate
  itself. **The bootstrap step is unavoidable; the only question is what runs
  it.**
- **The statusLine command always runs through a shell, and `"type":
  "command"` is the only type.** We can't avoid a shell wrapper entirely, but we
  can shrink it to a thin `node` call and move all selection logic into Node —
  killing the dependency on `ls`/`grep`/`sort -V`/`tail`. (`sort -V` is a
  GNU-ism; macOS `/usr/bin/sort` gained it only recently and it's not guaranteed
  in the subprocess environment — a real correctness bug, not just aesthetics.)

The resolver itself is a pure, tested function fed a cache-dir path:

- `fs.readdirSync` the plugin cache dir; keep only semver-named entries via a
  tiny structured parser returning `{ major, minor, patch }` (no npm `semver`
  dep — that would break the zero-runtime-dep rule).
- Select the highest by numeric comparison; ignore git-sha / non-version dirs.
- Return `null` (→ silent exit 0, empty bar) when nothing runnable exists —
  the "degrade, never crash" case a `/plugin uninstall` without
  `/cc-cream:uninstall` leaves behind.

Three viable ways to wire it, in increasing order of how much they shrink the
runtime command (pick one — this is a story-level decision, not a foregone
conclusion):

- **A — inline Node resolver.** statusLine command is
  `exec "<node>" -e "<inline resolver that readdirSyncs the cache and
  dynamic-`import()`s the latest cc-cream.js>"`. Self-contained, no copied
  files, always correct at render time, one process (the `import()` runs in the
  same Node — no second spawn, no latency regression). Cost: an inline script
  embedded in a JSON string is ugly, and the snippet must be kept in sync with
  the tested resolver function.
- **B — stable bootstrap file.** Copy one tiny `bootstrap.js` to
  `~/.claude/cc-cream/`; command is `exec "<node>" ~/.claude/cc-cream/bootstrap.js`.
  Fully testable as a real module, no inline-string duplication, always correct
  at render. Cost: reintroduces a single copied file in plugin mode (relaxes
  "the plugin cache IS the install" — acceptable for one user).
- **C — hook re-points an absolute path (recommended).** The SessionStart hook
  *does* have `${CLAUDE_PLUGIN_ROOT}` (its own dir = the current version), so it
  can write `exec "<node>" "<CLAUDE_PLUGIN_ROOT>/src/cc-cream.js"` into
  settings.json and refresh it whenever the version changes. The runtime command
  becomes a plain absolute `node` call with **zero resolution logic** —
  simplest, fastest, no glob, no inline script. Cost: the path is briefly stale
  between a `/plugin update` and the next SessionStart, and it leans on the hook
  running. This converts the hook's one-shot marker into an idempotent
  keep-fresh check (still never clobbering a foreign or user-removed line).

All three eliminate the shell-utility dependency and the `sort -V` bug; none can
use `${CLAUDE_PLUGIN_ROOT}` in the command itself.

### 2. One real extraction, not six services

`src/install.js` is 350 lines and already has the split the original plan was
reaching for: a pure decision core (`plan`, `planUninstall`, `autoUpdateCommand`,
`isCcCreamStatusLine`) plus an I/O shell. Splitting it into six "services"
(`settings-store`, `statusline-planner`, `command-factory`,
`runtime-copy-service`, `installer-cli`, `auto-setup-controller`) is
microservice cargo-culting on a file that doesn't warrant it — and the wrong
lesson to internalize from a sandbox.

Do the **one** extraction that removes genuine duplication: a shared
`src/settings.js` owning safe read (missing/empty → `{}`, corrupt → refuse and
report), atomic write, and corrupt-file refusal. Both `src/install.js:167`
(`readSettings`) and `hooks/auto-setup.js:38` currently implement this
separately; they should share it. Drop the other five splits.

### 3. Pure render — get filesystem I/O out of segment code

`src/segments.js` already returns `{ text, color }` objects and `src/render.js`
owns layout, so the path is more cohesive than the installer. Two sharp,
bounded improvements rather than a wholesale model rewrite:

- **Headline fix:** `segTtl` calls `fs.statSync(transcript_path)` *inside*
  segment rendering (`src/segments.js:59-77`). Filesystem I/O in the render path
  makes segments impure, hard to test, and a latency/error source. Resolve the
  TTL anchor timestamp upstream (in `cc-cream.js`/state) and inject it, so every
  segment function is pure: data + config + numbers in, facts out.
- **Don't duplicate layout into the model.** The original proposal's
  `{ id, row, zone, order, label, value, color }` re-encodes `row`/`zone`/
  `order`, which already live in config and `ROW1_ZONES` (`src/render.js:13-31`).
  Keep layout in config. Have segments return computed facts only —
  `{ label, value, color }` (or `{ metric, color }`) — and let the formatter
  assemble text. This gives tests structured facts to assert on without creating
  a second source of truth for ordering.

### 4. Add structured logic tests — keep golden render snapshots

For a status-line tool the rendered string *is* the product: ANSI codes,
separators, the 80-col budget, row collapsing. Replacing all output assertions
with structured-object checks would under-test exactly the layer users see. The
right balance:

- Add **structured unit tests** for metric/segment logic so tests stop
  regex-parsing values out of rendered rows (e.g. rate-limit countdowns at
  `features/step_definitions/steps.js:343`).
- **Keep a thin golden-snapshot layer** over full `render()` output for
  layout/ANSI/row-collapse behavior.
- **Delete** tests coupled to implementation text that's going away — notably
  the exact `grep`-regex assertion on the generated command
  (`features/step_definitions/steps.js:1267`), which dies with the shell
  resolver. Keep regex only where regex is the behavior under test (e.g.
  stripping terminal control characters).

### 5. Schema-driven config — and surface it to the user

`src/config.js:22-53`'s `if ('x' in def) out.x = fooOr(...)` ladder is exactly
what a per-key table replaces: `{ default, normalizer, domain }` keyed by config
key. Keep the forgiving behavior (invalid field → default). Two extensions:

- **Co-locate** the table with `DEFAULTS` in `src/defaults.js` so defaults and
  validators have one home and the segment set is self-describing.
- **Surface it.** Add a `cc-cream-setup --check-config` doctor that reports
  unknown / out-of-domain keys. Today a typo'd key is silently swallowed by the
  merge — fine at runtime, frustrating when a setting "does nothing" with no
  explanation.

## New: properties that make it world-class

The original plan was entirely about internal tidiness and said nothing about
what users feel. These are the higher-leverage additions.

### Diagnosability — `CC_CREAM_DEBUG`

"Degrade, never crash" means the bar silently vanishes on any unexpected input,
and the user has no way to learn why. Add an opt-in `CC_CREAM_DEBUG=1` that
records why the bar is empty (or which segments were dropped).

**Channel correction (verified):** Claude Code **silently discards statusLine
stderr** — it's only captured under `claude --debug`, and only for the first
invocation of a session. So stderr is *not* a usable user-facing channel.
Instead write debug output to a **log file** (e.g.
`~/.claude/cc-cream-debug.log`), gated on `CC_CREAM_DEBUG=1`, never touching
stdout (preserving the zero-token guarantee). Optionally also emit to stderr so
`claude --debug` shows the first-invocation reason inline. This is still the
single highest-value *new* feature for a tool engineered to fail quietly — only
the transport changes.

### A latency budget as an explicit constraint

State a target (e.g. p95 render < ~120ms cold) and make "no startup-time
regression" an acceptance criterion. Without it, item 1 can silently double
process spawns. This also kills the stale-baked-`node`-path problem:
`resolveNodePath` (`src/install.js:214`) bakes an absolute node path at setup
time that a node upgrade or version-manager switch invalidates — in-process
resolution sidesteps it, since the running process is already the right node.

### End-to-end cache-resolution test

Test the resolver against a real temp cache tree (multiple semver dirs + a
git-sha dir + an empty dir), asserting both the correct pick and the silent
exit-0 on an empty tree — not just the function in isolation.

### Showcase the plugin patterns

Treat the instructive plugin mechanics as reference material to polish and
document, not just code to refactor:

- the `SessionStart` autowire hook (`hooks/auto-setup.js`) working around
  statusLine not being plugin-manifest-settable (only `agent` /
  `subagentStatusLine` are);
- the consent-based, never-clobber-a-foreign-line install flow;
- the marketplace listing and OIDC trusted-publishing release path.

Document *why* each pattern exists. The lasting value of a sandbox is the
reference example it leaves behind.

## Cut from v1

- **The 10-service map.** It re-badges modules that already exist (`config.js`,
  `state.js`, `ttl.js`, `render.js`, `segments.js`) and invents artificial ones
  (a "service" wrapping the one-function `parseSession`). For a ~1000-line
  zero-dependency tool, "microservice boundaries inside the process" is
  vocabulary, not value. The module boundaries are already mostly correct.
- **Schema/state migration tooling** (see Premise).

## Plugin / npm submission safety check

None of the proposed work changes the surfaces that Claude Code's plugin
validation or npm publish actually inspect — verified against the docs and the
current layout:

- **`.claude-plugin/plugin.json` is untouched.** No `commands` key is added
  (commands stay auto-discovered from the top-level `commands/` dir), and we add
  no `statusLine` to the manifest — plugins can only set `agent` /
  `subagentStatusLine`, never the main statusLine (confirmed). The hook +
  `/cc-cream:setup` pattern remains the only viable wiring path.
- **The statusLine command lives in the user's settings.json, not in any
  validated artifact.** Changing its format is invisible to `claude plugin
  validate` and to npm. Safe to redesign freely.
- **Zero runtime dependencies preserved.** The semver pick uses a tiny in-repo
  parser, not the npm `semver` package — keeping the package dependency-free
  (and the Socket / bundle-size badges clean) and ESM / Node-built-ins-only.
- **No published-tarball surprises.** New code (`settings.js`, resolver,
  `--check-config`, debug logging) ships as ordinary `src/` modules; verify with
  `npm pack --dry-run`. The `prepublishOnly` gate (`npm test`) still guards the
  release.
- **CI guard still holds.** The default cucumber profile excludes `@manual` and
  `@needs-cli`; any new test that shells out to a live `claude` must be tagged
  `@needs-cli` so it can't break the CLI-less publish runner.
- **Portability is a side win.** Replacing the Unix coreutils pipeline with Node
  removes the `ls`/`grep`/`sort -V`/`tail` dependency. (The command still runs
  through a shell — unavoidable — so on Windows the `node` invocation and any
  paths still need forward slashes / Git-Bash care, but that's out of scope while
  the target is one macOS user.)

## Suggested implementation order

Invert v1's "refactor first, test after" for the contract-critical parts — lock
behavior, then change internals underneath it.

1. **Safety net first (no code change):** integration tests for cache-dir
   selection on a fixture tree, `settings.json` round-trip incl. corrupt-file
   refusal, and golden full-render snapshots.
2. Extract shared `src/settings.js`; point `install.js` and
   `hooks/auto-setup.js` at it.
3. In-process cache resolution replacing the shell one-liner; delete the dual
   command strategy and ownership reconciliation. Measure against the latency
   budget.
4. Pure render: lift the `statSync`/anchor resolution out of `segTtl`; segments
   return facts, formatter owns text.
5. Schema-table config in `defaults.js` + `--check-config` doctor.
6. Add `CC_CREAM_DEBUG` stderr diagnostics.
7. Trim now-redundant brittle tests; clean `knip.json`; document the plugin
   patterns and the new architecture.

## Acceptance criteria

- `npm test` passes.
- Plugin cache selection is resolved in-process and tested without invoking
  `sh`, `grep`, `sort`, or `tail`, including an end-to-end fixture-tree test.
- One shared settings module is used by both the CLI installer and the
  SessionStart hook.
- No filesystem I/O inside segment functions; segments are pure (data + config +
  injected anchors → facts).
- Render startup p95 does not regress versus the current shell command (the
  resolver runs in-process via dynamic `import()`, not a second `spawn`).
- `CC_CREAM_DEBUG=1` explains every degrade-to-empty in a debug log file (stderr
  is silently discarded by Claude Code); stdout stays token-free.
- Config normalization is a single schema table, with a `--check-config` doctor
  that reports unknown/out-of-domain keys.
- No runtime network calls or telemetry introduced; runtime stays
  zero-dependency / ESM / Node built-ins only.
