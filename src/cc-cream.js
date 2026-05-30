#!/usr/bin/env node
// cc-cream — Claude Code status-line engine.
// Reads the session JSON Claude Code pipes on stdin and prints a colored
// <=3-row bar. Hard rule: degrade, never crash.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { loadConfig, readConfigFile } from './config.js';
import { render } from './render.js';
import {
  getSessionState,
  nextSessionPatch,
  patchSessionState,
  readState,
  writeState,
} from './state.js';
import { isEntrypoint, isNum } from './utils.js';

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

// Resolve when the cache TTL window last reset, in epoch ms (or null to hide the
// ttl segment). This is the ONLY filesystem read on the render path — kept here
// in the I/O layer so render.js and the segments stay pure. Priority: token
// growth this turn (reset is now) → the last recorded API timestamp → the
// transcript file's mtime as a last resort.
function resolveTtlAnchor(data, prevSessionState, now) {
  const curTokens = data?.context_window?.total_input_tokens;
  const prevTokens = prevSessionState?.total_input_tokens;
  if (isNum(curTokens) && isNum(prevTokens) && curTokens > prevTokens) return now;
  if (isNum(prevSessionState?.last_api_ts)) return prevSessionState.last_api_ts;
  const tp = data?.transcript_path;
  if (typeof tp !== 'string' || tp === '') return null;
  try {
    return fs.statSync(tp).mtimeMs;
  } catch {
    return null;
  }
}

async function main() {
  const data = parseSession(await readStdin());
  const cfg = loadConfig(readConfigFile());
  const now = nowFromEnv(process.env);

  const sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null;
  const stateFile = path.join(os.homedir(), '.claude', 'cc-cream-state.json');
  const state = sessionId ? readState(stateFile) : {};
  const prevSessionState = getSessionState(state, sessionId);

  const ttlAnchorMs = resolveTtlAnchor(data, prevSessionState, now);
  const out = render(data, cfg, process.env, now, prevSessionState, ttlAnchorMs);
  if (out) process.stdout.write(`${out}\n`);

  if (sessionId) {
    const patch = nextSessionPatch(data, prevSessionState, cfg, now);
    writeState(stateFile, patchSessionState(state, sessionId, patch));
  }

  process.exit(0);
}

// isEntrypoint (src/utils.js) is symlink-robust — see its comment. A plain
// import.meta.url === pathToFileURL(argv[1]) check fails under a symlinked path and
// renders nothing with no error.
if (isEntrypoint(import.meta.url)) {
  main();
}
