#!/usr/bin/env node
// cc-cream — Claude Code status-line engine.
// Reads the session JSON Claude Code pipes on stdin and prints a colored
// <=3-row bar. Hard rule: degrade, never crash.

import { realpathSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, readConfigFile } from './config.js';
import { render } from './render.js';
import {
  getSessionState,
  nextSessionPatch,
  patchSessionState,
  readState,
  writeState,
} from './state.js';

export { DEFAULTS } from './defaults.js';
export { loadConfig } from './config.js';
export { render } from './render.js';
export { resolveTtl } from './ttl.js';
export { countdown, isPeak } from './utils.js';
export {
  getSessionState,
  nextSessionPatch,
  patchSessionState,
  readState,
  writeState,
} from './state.js';

async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

function parseSession(raw) {
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // malformed/empty stdin -> render with no data -> empty bar
  }
  return {};
}

function nowFromEnv(env) {
  const rawNow = env.CC_CREAM_NOW;
  return rawNow && Number.isFinite(Number(rawNow)) ? Number(rawNow) : Date.now();
}

async function main() {
  const data = parseSession(await readStdin());
  const cfg = loadConfig(readConfigFile());
  const now = nowFromEnv(process.env);

  const sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null;
  const stateFile = path.join(os.homedir(), '.claude', 'cc-cream-state.json');
  const state = sessionId ? readState(stateFile) : {};
  const prevSessionState = getSessionState(state, sessionId);

  const out = render(data, cfg, process.env, now, prevSessionState);
  if (out) process.stdout.write(`${out}\n`);

  if (sessionId) {
    const patch = nextSessionPatch(data, prevSessionState, cfg, now);
    writeState(stateFile, patchSessionState(state, sessionId, patch));
  }

  process.exit(0);
}

// Robust "is this module the entrypoint?" check. Node's ESM loader canonicalizes
// import.meta.url (symlinks resolved), but process.argv[1] stays as it was invoked.
// A plain href comparison therefore fails silently when cc-cream runs from a
// symlinked path — e.g. a ~/.claude managed by a dotfile manager (stow/chezmoi/yadm)
// or synced via iCloud/Dropbox — skipping main() so the bar renders NOTHING with no
// error. Comparing realpaths makes the symlinked and canonical paths match. Falls
// back to the href comparison if realpath fails (e.g. a path that no longer exists).
function isEntrypoint() {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(arg);
  } catch {
    return import.meta.url === pathToFileURL(arg).href;
  }
}

if (isEntrypoint()) {
  main();
}
