---
description: Remove cc-cream's statusLine wiring from settings.json. Run this BEFORE /plugin uninstall cc-cream (this command lives in the plugin and disappears with it).
allowed-tools: Bash(node:*)
---

Removing cc-cream's status-bar wiring from `~/.claude/settings.json`. Run `/plugin uninstall cc-cream` afterwards to drop the plugin — if you already removed the plugin, run `npx -y -p cc-cream cc-cream-setup --uninstall` to clear the leftover wiring.

!`node ${CLAUDE_PLUGIN_ROOT}/src/install.js --uninstall`
