#!/usr/bin/env bash
# Installer for the temper status line.
#
# Copies statusline-command.sh into ~/.claude/ and wires it into settings.json with
# refreshInterval=1 so the session/idle timers tick live (re-runs every second, even
# while idle).
#
# Run this YOURSELF from your shell (not via Claude): Claude Code's auto-mode classifier
# blocks the agent from editing ~/.claude/settings.json as self-modification of agent
# config. Running this installer from your own shell is the supported way to apply it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="$HOME/.claude"
SETTINGS="$CLAUDE_DIR/settings.json"
SRC="$SCRIPT_DIR/statusline-command.sh"
DEST="$CLAUDE_DIR/statusline-command.sh"

command -v jq >/dev/null      || { echo "error: jq is required (brew install jq)"; exit 1; }
command -v python3 >/dev/null || { echo "error: python3 is required"; exit 1; }

mkdir -p "$CLAUDE_DIR"

echo "→ installing status line script to $DEST"
cp "$SRC" "$DEST"
chmod +x "$DEST"

[ -f "$SETTINGS" ] || echo "{}" > "$SETTINGS"

echo "→ backing up settings.json to $SETTINGS.bak"
cp "$SETTINGS" "$SETTINGS.bak"

echo "→ wiring statusLine + refreshInterval into settings.json"
tmp="$(mktemp)"
jq -a --arg cmd "bash $DEST" '
    .statusLine.type = "command"
  | .statusLine.command = $cmd
  | .statusLine.refreshInterval = 1
' "$SETTINGS.bak" > "$tmp"
mv "$tmp" "$SETTINGS"

echo
echo "done ✓  Restart Claude Code for refreshInterval to take effect."
echo "statusLine block is now:"
jq '.statusLine' "$SETTINGS"
