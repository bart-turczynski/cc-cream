---
description: Wire cc-cream into your settings.json with a self-updating statusLine command.
allowed-tools: Bash(node:*)
---

Run the cc-cream installer in plugin mode. This shells out to the existing,
tested `install.js`, which deterministically writes the `statusLine` block into
`~/.claude/settings.json`. It asks before replacing any existing statusLine,
preserves your `padding`, and surfaces the trust/restart requirement.

In plugin mode the installer does NOT copy files into your home directory — the
plugin cache is the install. The command it writes self-resolves the highest
installed version on every render, so `/plugin update` applies a new version
with no further steps and no network calls.

!`node ${CLAUDE_PLUGIN_ROOT}/src/install.js --plugin`
