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
import { isCcCreamStatusLine, plan, resolveNodePath, writeFileAtomic } from '../src/install.js';

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

function emit(systemMessage) {
  process.stdout.write(`${JSON.stringify({ systemMessage })}\n`);
}

// Missing file -> {} (fresh, slot free). Unreadable/malformed -> null (leave alone).
function readSettings() {
  let raw;
  try {
    raw = fs.readFileSync(settingsPath(), 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? {} : null;
  }
  if (raw.trim() === '') return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
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
  // Act at most once: after we've auto-wired (or deferred to setup) once, leave the
  // user alone — never fight a statusLine they deliberately removed.
  if (fs.existsSync(markerPath())) return;

  const settings = readSettings();
  if (settings === null) return; // malformed/unreadable — don't touch it

  const existing = settings.statusLine;

  // Already cc-cream's (under ANY install strategy) — nothing to do; stay silent.
  if (isCcCreamStatusLine(existing)) {
    writeMarker();
    return;
  }

  // Some other statusLine is set — never clobber it; point to setup once.
  if (existing) {
    writeMarker();
    emit(
      'cc-cream is installed, but you already have a status line. Run /cc-cream:setup to replace it with cc-cream’s.',
    );
    return;
  }

  // The slot is free — wire cc-cream's statusLine for the user.
  let result;
  try {
    result = plan(settings, { plugin: true, nodePath: resolveNodePath() });
  } catch {
    return;
  }
  if (!result.changed) return; // defensive — plan should always write here
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true });
    writeFileAtomic(settingsPath(), `${JSON.stringify(result.settings, null, 2)}\n`);
  } catch {
    return; // couldn't write — say nothing, try again next session
  }
  writeMarker();
  emit(
    'cc-cream enabled your status bar. Restart or trust this workspace if it doesn’t appear. Run /cc-cream:uninstall to remove it.',
  );
}

main();
process.exit(0);
