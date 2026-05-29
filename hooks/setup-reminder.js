#!/usr/bin/env node
// SessionStart hook (plugin only). Claude Code can't wire the statusLine into
// settings.json when a plugin is installed — that needs the explicit /cc-cream:setup
// step. This hook nudges the user to run it, but ONLY while cc-cream's bar isn't
// wired yet, so it self-silences the moment setup runs.
//
// Output contract: a single JSON object with `systemMessage` — shown to the user
// in the terminal, NOT added to the model context (zero tokens, true to cc-cream's
// whole point). Emitting nothing = no message. Always exits 0; degrade, never crash.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const MESSAGE =
  'cc-cream is installed but the status bar isn’t wired up yet — run /cc-cream:setup to enable it.';

function configDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}

// True if cc-cream's statusLine is already wired under ANY strategy (plugin
// cache-glob, npm/manual home copy, or dev repo) — every variant references the
// cc-cream entrypoint. Mirrors install.js's isCcCreamStatusLine.
function isCcCreamWired(statusLine) {
  return (
    !!statusLine &&
    typeof statusLine === 'object' &&
    statusLine.type === 'command' &&
    typeof statusLine.command === 'string' &&
    statusLine.command.includes('cc-cream')
  );
}

// Decide whether to nudge. Missing settings.json -> fresh machine, not wired ->
// nudge. Unreadable/malformed -> stay silent (don't pile noise onto a broken
// settings file we can't reason about).
function shouldRemind() {
  const file = path.join(configDir(), 'settings.json');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return true; // no settings.json yet
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false; // malformed — say nothing
  }
  return !isCcCreamWired(parsed?.statusLine);
}

if (shouldRemind()) {
  process.stdout.write(`${JSON.stringify({ systemMessage: MESSAGE })}\n`);
}
process.exit(0);
