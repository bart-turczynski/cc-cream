# Shipping a Claude Code plugin that also has Node dev tooling

Notes for anyone distributing a Claude Code plugin from a repo that *also* carries
its own `package.json` / dev dependencies / test suite (cc-cream is one such repo).
These are the non-obvious traps we hit and how we worked around them, with links to
the upstream Claude Code issues so you can track fixes.

> Verified against Claude Code, June 2026. Behavior may change — check the linked
> issues before assuming these workarounds are still necessary.

---

## 1. The installer runs `npm install` on any `package.json` in the cached plugin tree

When you `/plugin install`, Claude Code copies the plugin's marketplace `source`
directory into `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/` and, if it
finds a **`package.json` at the root of that copied tree, runs a full `npm install`** —
including **devDependencies**, with no `--omit=dev`. For a plugin whose runtime needs
zero dependencies but whose repo carries Biome / Cucumber / a bundler / etc., this can
silently pull **tens to hundreds of MB** into the cache.

- cc-cream's cache ballooned to ~114 MB (its entire devDependency tree).
- The `impeccable` plugin hit ~291 MB the same way:
  https://github.com/pbakaus/impeccable/issues/107
- Related: https://github.com/anthropics/claude-code/issues/37093

### Fix: keep `package.json` out of the cached tree

Put the plugin payload in a **subdirectory** and point the marketplace `source` at it.
Only that subdirectory is copied into the cache, so if `package.json` lives at the repo
root (outside the subdir), the installer finds nothing to install.

```
repo/
  package.json            # dev + npm publish — NOT in the plugin source tree
  package-lock.json
  features/  scripts/      # dev-only, stay at root
  .claude-plugin/
    marketplace.json       # at repo root so the marketplace is discoverable
                           #   plugin entry: "source": "./plugin"
  plugin/                  # <-- the ONLY thing copied into the cache
    .claude-plugin/
      plugin.json
    commands/
    hooks/
    src/                   # zero-runtime-dep engine
```

Why this works: Claude Code copies *only* the `source` subdirectory (confirmed against
other multi-plugin marketplaces), so `${CLAUDE_PLUGIN_ROOT}` equals that subdir. With no
`package.json` inside it, no `npm install` runs.

Notes:
- `.npmrc` with `omit=dev` is **not** a reliable fix: the installer may ignore it, and a
  repo-wide `omit=dev` breaks local dev/CI (`npm install`, `npm ci`, coverage).
- The npm package and the plugin can share one `src/` only if it lives inside the plugin
  subdir; point `bin`/`files` in `package.json` at `plugin/src/`.
- Sanity checks after restructuring:
  - `find plugin -name 'package*.json'` → must be empty.
  - `du -sh ~/.claude/plugins/cache/<mkt>/<plugin>` after a real install → should be KB.

---

## 2. Updates are version-gated, and `/plugin update` does NOT refresh the marketplace clone

Two separate gotchas combine to make "I merged the fix to `main`" reach **nobody**:

1. **Version-gated cache.** `/plugin update <plugin>` compares the installed version to
   the marketplace clone's `plugin.json` `version`. If they're equal it silently no-ops
   and keeps the stale cache — *even if `main` has newer commits with the same version
   string*. This is documented (buried) in the Create Plugins guide: "pushing new commits
   alone is not enough because Claude Code sees the same version string and keeps the
   cached copy." So **you must bump `plugin.json`'s `version`** for a fix to propagate.

2. **Stale marketplace clone.** `/plugin update <plugin>` updates the plugin *from the
   local marketplace clone* but does **not** git-pull that clone. You must refresh it
   first. This is a widely-reported bug, not intended behavior:
   - https://github.com/anthropics/claude-code/issues/46081
   - https://github.com/anthropics/claude-code/issues/37252
   - https://github.com/anthropics/claude-code/issues/28540
   - https://github.com/anthropics/claude-code/issues/35752
   - https://github.com/anthropics/claude-code/issues/21995

### To actually ship a fix to installed users

1. Bump `version` in **every** location and keep them in lockstep — for cc-cream that's
   `package.json`, `package-lock.json`, and `plugin/.claude-plugin/plugin.json`.
   (cc-cream's `scripts/release.mjs` does this in one shot.)
2. Merge to the default branch.
3. Users refresh in **two** steps — the first is the one people miss:
   ```
   /plugin marketplace update <marketplace>
   /plugin update <plugin>
   ```

### To force-fix one machine right now (no version bump)

A fresh install/reinstall isn't version-gated. Or run the installer's escape hatch
directly (see §4) — that always reflects the current cache.

---

## 3. `$ARGUMENTS` *does* expand inside `` !`bang` `` commands

A custom slash command can forward its arguments into the bash that runs before the
prompt. We verified empirically that running `/cmd foo --bar` against a command whose body
is `` !`some-script $ARGUMENTS` `` executes `some-script foo --bar` — the substitution
happens to the file text *before* the bang runs. (Some readings of the docs suggest
otherwise; the empirical result is that it works.) cc-cream relies on this so
`/cc-cream:setup --force` forwards `--force` to the installer.

Caveat: bang commands run in a sandbox and can only write inside the session's working
directory — output redirection to `/tmp` (etc.) is blocked.

---

## 4. A consent prompt can't run inside a slash command (no TTY)

Slash commands execute their `!` bang with **no interactive TTY**, so an installer can't
`readline`-prompt for "replace your existing statusLine?". cc-cream handles this by:

- Safely overwriting its **own** prior wiring without asking.
- Never clobbering a **foreign** statusLine non-interactively unless `--force` is passed.

So to replace a foreign statusLine, pass a literal `--force` — e.g. the npm bin
`cc-cream-setup --force`, or run the cached entrypoint directly:

```bash
node ~/.claude/plugins/cache/<mkt>/cc-cream/<version>/src/install.js --plugin --force </dev/null
```

(`/cc-cream:setup --force` works too, *once the cache actually has the `--force`-aware
version* — see §2.)

---

## 5. Applying plugin changes without restarting the session

Claude Code builds its plugin registry — slash commands, skills, agents, hooks, MCP/LSP
servers — **once, at session start**. Installing / updating / removing a plugin mid-session
changes files on disk and `settings.json` but does **not** rebuild the live registry.
Everything below follows from that one fact:

| Event | Rebuilds command/skill registry | Keeps your conversation | Fires `SessionStart` hooks |
|-------|:---:|:---:|:---:|
| `plugin install` / `update` (mid-session) | ❌ | ✅ | ❌ |
| `/reload-plugins` | ✅ | ✅ | ❌ |
| `/clear` | ✅ (re-init) | ❌ **wipes context** | ✅ |
| relaunch, then `claude -c` / `--resume` | ✅ | ✅ | ✅ |

Consequences:
- After a fresh install/update, your `/<plugin>:*` commands won't appear until
  **`/reload-plugins`** — which rebuilds the registry *and keeps your conversation*.
- A `SessionStart`-wired feature (e.g. cc-cream's statusLine, set by `hooks/auto-setup.js`)
  needs an actual session start — `/reload-plugins` will **not** fire it. Start a new
  session, or run the plugin's own setup command (`/cc-cream:setup`) to wire it now.
- **Don't reach for `/clear` to "refresh" plugins** — it does rebuild the registry and fire
  `SessionStart`, but it **discards your current conversation**. Use `/reload-plugins`.

(The mirror image on uninstall: a removed plugin's slash commands *linger* in the picker
until the session restarts.)

## 6. Migrating users off a pre-plugin "standalone" install

If your tool had an earlier life as a hand-wired install — e.g. a `statusLine` command
pointed directly at a file you copied into `~/.claude/…` — that wiring **wins and persists**
even after the user installs the plugin, so they keep running the old engine. There is no
auto-migration; detect and clean *before* installing:

1. Inspect what `~/.claude/settings.json`'s `statusLine` actually points at. A hand-wired
   absolute path (`node /Users/<you>/.claude/cc-cream/cc-cream.js`) is stale; a guarded
   `[ -f "…/plugins/cache/<mkt>/<plugin>/<ver>/src/cc-cream.js" ] || exit 0; exec …` command
   is the plugin-managed one.
2. Remove the hand-wired `statusLine` block (back up `settings.json` first) and delete any
   standalone copy + scratch state (`rm -rf ~/.claude/cc-cream ~/.claude/cc-cream-state.json`).
3. Install via the marketplace — **add first, then install**, and mind the `plugin@marketplace`
   order: `plugin marketplace add <repo>` → `plugin install <plugin>@<marketplace>`.
   (`plugin install <repo>` fails with "Marketplace not found".)
4. Activate without a restart per §5: `/reload-plugins` for the commands; a new session or
   the setup command for a `SessionStart`-wired bar. With the `statusLine` slot now empty,
   cc-cream's hook auto-wires the bar on the next session start.

## Release checklist (cc-cream)

- [ ] Update `CHANGELOG.md` (roll `[Unreleased]` → the new version).
- [ ] Bump `version` in `package.json`, `package-lock.json`, `plugin/.claude-plugin/plugin.json` (lockstep).
- [ ] `npm test` green; `npm pack --dry-run` ships `plugin/src/` only; `claude plugin validate plugin` passes.
- [ ] `find plugin -name 'package*.json'` is empty (no cache bloat).
- [ ] Merge to `main` (this does **not** publish).
- [ ] Publish to npm: `gh release create vX.Y.Z` (the GitHub Release is the only publish trigger).
- [ ] To verify the plugin channel: `/plugin marketplace update <mkt>` → `/plugin update <plugin>` → `du -sh` the cache.
