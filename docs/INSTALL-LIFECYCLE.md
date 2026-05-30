# Install lifecycle & migration quirks

> **Status:** working notes, not yet folded into `README.md`.
> **Why this exists:** the install/uninstall path has eaten the majority of cc-cream's
> engineering effort. Most of the friction is *not* in cc-cream's code — it's in how
> Claude Code loads and unloads plugin components across a session boundary. This file
> captures the mental model, the two quirks that keep biting, and the exact migration
> steps for a machine still running a pre-plugin standalone install.
>
> Audience: future-me (on another computer) and any agent picking this up cold. It is
> deliberately self-contained — you should be able to act from this file alone.

---

## 1. The one mental model that explains everything

**Claude Code builds its plugin registry — slash commands, skills, agents, hooks,
MCP/LSP servers — once, at session start. Installing or removing a plugin mid-session
changes files on disk and `settings.json`, but does *not* rebuild the live registry.**

Everything below is a corollary of that single fact. Two events rebuild/re-fire things:

| Event | Rebuilds command/skill registry | Keeps your conversation | Fires `SessionStart` hooks |
|-------|:---:|:---:|:---:|
| `claude plugin install …` (mid-session) | ❌ | ✅ | ❌ |
| `/reload-plugins` | ✅ | ✅ | ❌ |
| `/clear` | ✅ (via re-init) | ❌ **(wipes context)** | ✅ |
| relaunch, then `claude -c` / `--resume` | ✅ | ✅ | ✅ |

(Confirmed against Claude Code docs: *Discover plugins → "Apply plugin changes without
restarting"*, *Sessions → "Resume a session"*, *Hooks guide → `SessionStart`*.)

---

## 2. Quirk A — freshly installed commands/bar don't appear in the running session

### Symptom
You run `claude plugin install cc-cream@cc-cream`, it reports success, you can even see
the plugin listed — but typing `/cc-cream:` offers nothing, and no status bar appears.

### Cause
The running session's registry predates the install (see §1). The plugin is on disk and
enabled in `settings.json`, but nothing told the live session to re-scan.

### Fix
- **For the slash commands:** run **`/reload-plugins`**. It rebuilds the registry in place
  and **keeps your conversation**. This is the correct, cheap move.
- **For the status bar specifically:** the bar is wired by cc-cream's `SessionStart` hook
  (`hooks/auto-setup.js`), which **only fires on a real session start** — a fresh launch,
  `--continue`/`--resume`, or `/clear`. `/reload-plugins` will *not* trigger it. So either
  start a new session, or run **`/cc-cream:setup`** (the plugin's own command) to wire the
  `statusLine` immediately without restarting.

### The trap to avoid
`/clear` *does* make the commands appear (it re-initialises the session, which also fires
`SessionStart` and wires the bar) — **but it discards your current conversation.** Reaching
for `/clear` to "refresh" plugins costs you your working session. Use `/reload-plugins`
instead; only use `/clear` when you actually want a blank context.

### Relationship to existing docs
This is the **mirror image** of an already-documented behaviour. The uninstall side — that
slash commands *linger* until restart — is covered (`README.md` Uninstall, `CHANGELOG.md`
under 0.3.x, and asserted in `features/09-installer.feature:102`: *"the output says the
slash commands linger until restart"*). The **install side** (commands *absent* until
reload) and the `/reload-plugins` remedy are **not** documented anywhere in the repo. That
gap is what this section closes. Note: `CHANGELOG.md` ~line 122 logs a *different*
"commands not appearing after install" — that was a manifest path-resolution bug
(`commands/` vs `.claude-plugin/commands/`), since fixed, and is unrelated to this
session-lifecycle issue.

---

## 3. Quirk B — "old files sticking around": migrating off a pre-plugin standalone install

### Background
Before the marketplace/plugin distribution existed, cc-cream was installed as a **single
standalone file** copied to `~/.claude/cc-cream/cc-cream.js`, with `settings.json` pointing
a `statusLine` command directly at that absolute path. Machines set up in that era keep
running the **old v1 engine** even after you think you've "installed" the plugin — because
the hand-wired `statusLine` still wins and nothing ever removed it.

The README's *"pick one install method"* note (Install → Option 1) warns about
npm/manual-then-plugin, but does **not** cover this older hand-wired standalone directory.
That's the exact "old files sticking around" failure seen on more than one machine.

### How to detect it (run these on the suspect machine)

```bash
# 1. What is the statusLine actually pointing at?
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print(json.dumps(d.get('statusLine','<none>'), indent=2))"
#   STALE  → "command": "node /Users/<you>/.claude/cc-cream/cc-cream.js"   (hand-wired absolute path)
#   GOOD   → "command": "[ -f \"…/plugins/cache/cc-cream/cc-cream/<ver>/src/cc-cream.js\" ] || exit 0; exec …"

# 2. Is there a leftover standalone copy + its shape (single-file v1 vs modular v2)?
ls -la ~/.claude/cc-cream/ 2>/dev/null
wc -l ~/.claude/cc-cream/cc-cream.js 2>/dev/null     # ~419 lines & monolithic == old v1

# 3. Is the marketplace added and the plugin actually installed?
grep -o '"cc-cream"' ~/.claude/plugins/known_marketplaces.json 2>/dev/null && echo "marketplace: present" || echo "marketplace: NOT added"
grep -o 'cc-cream@cc-cream' ~/.claude/plugins/installed_plugins.json 2>/dev/null && echo "plugin: installed" || echo "plugin: NOT installed"

# 4. Sweep for any other cc-cream footprint (state file, debug log, markers)
find ~/.claude -maxdepth 2 -iname "*cc-cream*" 2>/dev/null | grep -v 'projects/'
```

On the affected machine in this session we found: stale standalone `~/.claude/cc-cream/cc-cream.js`
(May, 419-line single-file v1), `statusLine` hand-wired to it, **no** marketplace, **no**
plugin installed, plus a stray `~/.claude/cc-cream-state.json`. Importantly there was **only
one** footprint — no duplicate/ghost copies — so this machine had the *stale* problem, not
the *corruption* problem.

### Clean-slate removal (do this BEFORE installing the plugin)

```bash
# Back up settings.json first (optional but cheap)
cp ~/.claude/settings.json ~/.claude/settings.json.bak-cc-cream

# Remove the hand-wired statusLine block from ~/.claude/settings.json
#   → delete the entire  "statusLine": { … },  object. Leave every other key intact.
#   (Edit by hand, or with a JSON tool — do not blunt-force regex if other keys matter.)

# Remove the stale standalone engine and its scratch state
rm -rf ~/.claude/cc-cream
rm -f  ~/.claude/cc-cream-state.json

# Verify settings.json is still valid JSON and statusLine is gone
python3 -c "import json; d=json.load(open('$HOME/.claude/settings.json')); print('valid JSON'); print('statusLine present:', 'statusLine' in d)"

# Final sweep — should be clean (the project working dir under ~/.claude/projects is unrelated, ignore it)
find ~/.claude -iname "*cc-cream*" 2>/dev/null | grep -vE 'projects/|\.bak-cc-cream'
```

### Then install fresh (marketplace path)

```bash
# Run these as shell commands (the leading `!` form inside a Claude Code session works too).
claude plugin marketplace add bart-turczynski/cc-cream
claude plugin install cc-cream@cc-cream
```

Notes:
- `/plugin install bart-turczynski/cc-cream` fails with *"Marketplace not found"* — that
  syntax is `plugin@marketplace`, and the marketplace must be **added first**. Use the two
  commands above in order.
- The marketplace clones over SSH (`git@github.com:…`), so the machine needs a working SSH
  key for GitHub, or add via an HTTPS source instead.

### Activate without a full restart
After installing, the running session still has the stale (now-empty) registry — apply §2:
- `/reload-plugins` → makes `/cc-cream:*` available.
- Because the `statusLine` slot is now **empty** (you removed the hand-wired one), the next
  `SessionStart` auto-wires cc-cream's bar automatically. To get the bar *now* without
  waiting for a new session, run `/cc-cream:setup`.

### What "correct" looks like afterward
```jsonc
// ~/.claude/settings.json → statusLine
{
  "type": "command",
  "command": "[ -f \"/Users/<you>/.claude/plugins/cache/cc-cream/cc-cream/<ver>/src/cc-cream.js\" ] || exit 0; exec \"<node>\" \"…/<ver>/src/cc-cream.js\"",
  "refreshInterval": 60
}
```
The `[ -f … ] || exit 0` guard is cc-cream's **ghost-bar self-defense**: if the cached file
ever disappears (e.g. after `/plugin uninstall` without clearing the wiring), the bar
silently vanishes instead of erroring. A one-shot marker
(`~/.claude/plugins/data/cc-cream-cc-cream/cc-cream-autowire-done`) records that auto-wire
ran, so the hook never re-adds a bar you deliberately removed. Updates are automatic: when
`/plugin update` drops a new version into the cache, the `SessionStart` hook re-pins the
path on the next session.

---

## 4. Uninstall, for completeness (already documented, summarised here)

Order matters because `/cc-cream:uninstall` lives *inside* the plugin and disappears with it,
and Claude Code can't clean `settings.json` when a plugin is removed:

```
/cc-cream:uninstall          # 1. removes the statusLine wiring (run FIRST); also clears scratch
/plugin uninstall cc-cream   # 2. drops the plugin
# optional, host doesn't do these for you:
rm -rf ~/.claude/plugins/cache/cc-cream     # the version cache
/plugin marketplace remove cc-cream          # the marketplace entry
```
The slash commands linger in the picker until the session restarts (the install-side mirror
of §2). `/cc-cream:uninstall --purge` additionally deletes your `~/.claude/cc-cream.json`.

---

## 5. TL;DR checklist for the other computer

1. **Detect** — run the §3 detection block. Stale standalone? Marketplace missing?
2. **Clean** — §3 removal block: drop the hand-wired `statusLine`, `rm -rf ~/.claude/cc-cream`,
   remove the state file. Confirm `settings.json` is still valid JSON.
3. **Install** — `marketplace add` then `install` (in that order, §3).
4. **Activate without losing your session** — `/reload-plugins` for the commands; `/cc-cream:setup`
   (or a new session) for the bar. **Do not use `/clear` just to refresh plugins** — it wipes
   your conversation (§2 trap).
5. **Verify** — `statusLine` now points at the guarded `plugins/cache/.../src/cc-cream.js`
   path (§3 "correct looks like"), and the bar renders the modular three-row layout.
