---
description: "Wire cc-cream into your settings.json. --show/--hide toggle segments (e.g. --hide 5h,7d,peak). --set applies config values (e.g. --set percentage=remaining --set ctx.ceiling=100000 --set ctx.amber=20). Multiple --set flags are allowed."
allowed-tools: Bash(node:*)
---

!`node ${CLAUDE_PLUGIN_ROOT}/src/install.js --plugin $ARGUMENTS`

Show the command output above to the user verbatim — it's the setup result — then stop, no extra commentary.
