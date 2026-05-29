---
description: Remove cc-cream's statusLine wiring from your settings.json.
allowed-tools: Bash(node:*)
---

Run the cc-cream uninstaller. This shells out to the existing, tested
`install.js`, which removes the `statusLine` block from `~/.claude/settings.json`
**only if it is cc-cream's** — a statusLine you wired for anything else is left
untouched. It then offers to delete the copied runtime and session-state files,
and keeps your `~/.claude/cc-cream.json` config unless you remove it yourself.

This does not remove the plugin itself. Run `/plugin uninstall cc-cream`
afterwards to drop the plugin from the cache. Restart Claude Code to clear the bar.

!`node ${CLAUDE_PLUGIN_ROOT}/src/install.js --uninstall`
