---
description: Remove cc-cream's statusLine wiring from settings.json. Run this BEFORE /plugin uninstall cc-cream (this command lives in the plugin and disappears with it).
allowed-tools: Bash(node:*)
---

!`node ${CLAUDE_PLUGIN_ROOT}/src/install.js --uninstall $ARGUMENTS`

Show the command output above to the user verbatim — it's the uninstall receipt, including how to clear the lingering cache — then stop, no extra commentary.
