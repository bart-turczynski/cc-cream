#!/usr/bin/env node
// SessionStart hook (plugin only). Claude Code can't contribute the main
// statusLine from a plugin (only `agent`/`subagentStatusLine` are plugin-settable),
// so the bar needs install.js to write ~/.claude/settings.json. Rather than make
// the user run /cc-cream:setup by hand, this hook does it automatically on the
// FIRST session after install — but only when the statusLine slot is free, so it
// never clobbers a line you set for something else (that path still routes through
// the interactive /cc-cream:setup). A one-shot marker records that we've acted, so
// we never re-wire a bar you later removed with /cc-cream:uninstall.
//
// Output is a single `systemMessage`: shown to the user, NOT added to the model
// context (zero tokens). Reuses install.js's tested plan() for the decision.
// Degrade, never crash; always exit 0.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { isCcCreamStatusLine, plan, resolveNodePath } from '../src/install.js';
import { isSafeToWrite, readSettings as readSettingsFile, writeFileAtomic } from '../src/settings.js';

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
// Marker lives in the plugin's persistent data dir when available, so it survives
// plugin updates; falls back to the config dir.
function markerPath() {
  return path.join(process.env.CLAUDE_PLUGIN_DATA || configDir(), 'cc-cream-autowire-done');
}
function settingsPath() {
  return path.join(configDir(), 'settings.json');
}
// The absolute path to THIS plugin version's engine. ${CLAUDE_PLUGIN_ROOT} is
// the path Claude Code blesses for the current version (set for hook processes);
// fall back to this hook's own location (../src/cc-cream.js) when it's absent
// (e.g. in tests). This is what we bake into the statusLine — re-pinned here on
// every session, so a /plugin update moves the bar to the new version.
function entrypoint() {
  const root = process.env.CLAUDE_PLUGIN_ROOT;
  if (root) return path.join(root, 'src', 'cc-cream.js');
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'cc-cream.js');
}

function emit(systemMessage) {
  process.stdout.write(`${JSON.stringify({ systemMessage })}\n`);
}

// Missing/empty -> {} (fresh, slot free). Unreadable/malformed/non-object ->
// null (leave it alone — never overwrite the user's other settings).
function readSettings() {
  const { state, value } = readSettingsFile(settingsPath());
  return isSafeToWrite(state) ? value : null;
}

function writeMarker() {
  try {
    fs.mkdirSync(path.dirname(markerPath()), { recursive: true });
    fs.writeFileSync(markerPath(), '');
  } catch {
    /* best-effort; a missed marker just means we may act again next session */
  }
}

function main() {
  const settings = readSettings();
  if (settings === null) return; // malformed/unreadable — don't touch it

  const existing = settings.statusLine;
  const ep = entrypoint();

  // Keep-fresh: an EXISTING cc-cream line is maintained every session (NOT gated
  // by the marker), so a /plugin update re-pins the baked path to the new
  // version. We own the slot, so record the marker too.
  if (isCcCreamStatusLine(existing)) {
    writeMarker();
    // Already points at the current entrypoint → nothing to do, stay silent.
    if (typeof existing.command === 'string' && existing.command.includes(ep)) return;
    if (!writeStatusLine(settings, ep)) return;
    return; // silent re-pin — a routine version bump needs no announcement
  }

  // Creation is gated by the one-shot marker: after we've auto-wired (or deferred
  // to setup) once, never re-create a bar the user deliberately removed.
  if (fs.existsSync(markerPath())) return;

  // Some other statusLine is set — never clobber it; point to setup once.
  if (existing) {
    writeMarker();
    emit(
      'cc-cream is installed, but you already have a status line. Run /cc-cream:setup to replace it with cc-cream’s.',
    );
    return;
  }

  // The slot is free — wire cc-cream's statusLine for the user.
  if (!writeStatusLine(settings, ep)) return;
  writeMarker();
  emit(
    'cc-cream enabled your status bar. Restart or trust this workspace if it doesn’t appear. Run /cc-cream:uninstall to remove it.',
  );
}

// Plan + atomically write cc-cream's statusLine for `entrypoint`. Returns true on
// a successful write, false if there was nothing to change or the write failed.
function writeStatusLine(settings, ep) {
  let result;
  try {
    result = plan(settings, { entrypoint: ep, nodePath: resolveNodePath() });
  } catch {
    return false;
  }
  if (!result.changed) return false;
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    writeFileAtomic(settingsPath(), `${JSON.stringify(result.settings, null, 2)}\n`);
  } catch {
    return false; // couldn't write — say nothing, try again next session
  }
  return true;
}

main();
process.exit(0);
