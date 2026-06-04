#!/usr/bin/env node
// cc-cream — Claude Code status-line engine.
// Reads the session JSON Claude Code pipes on stdin and prints a colored
// <=3-row bar. Hard rule: degrade, never crash.

import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig, readConfigFile } from './config.js';
import { isOrphanedPluginRun } from './orphan.js';
import { PATHS } from './paths.js';
import { buildSegments, render } from './render.js';
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

// CC_CREAM_DEBUG is opt-in diagnostics. Claude Code SILENTLY DISCARDS statusLine
// stderr (it's only surfaced under `claude --debug`, first invocation), so the
// channel is a log FILE — never stdout, which would cost tokens / corrupt the
// bar. CC_CREAM_DEBUG_LOG overrides the path (used by tests).
const debugEnabled = (env) => {
  const v = env.CC_CREAM_DEBUG;
  return typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';
};

function writeDebug(env, lines) {
  const file = env.CC_CREAM_DEBUG_LOG || PATHS.debugLog();
  try {
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    // diagnostics must never affect the render — swallow any write failure
  }
}

// Record why the bar looks the way it does: which on-by-config segments rendered
// and which were dropped (the usual reason a bar is shorter/emptier than
// expected — a missing or malformed stdin field). Recomputes the segment map
// through buildSegments() so it can never diverge from what render() drew.
function logDebug(env, { data, cfg, now, prevSessionState, sessionId, rawLen, ttlAnchorMs, out }) {
  const { ttlMin, segs } = buildSegments(data, cfg, env, now, prevSessionState, ttlAnchorMs);
  const onIds = Object.keys(cfg.segments).filter((id) => cfg.segments[id].on);
  const visible = onIds.filter((id) => segs[id]);
  const hidden = onIds.filter((id) => !segs[id]);
  writeDebug(env, [
    `[${new Date(now).toISOString()}] session=${sessionId ?? 'none'} stdinBytes=${rawLen} ttlMin=${ttlMin} ttlAnchor=${ttlAnchorMs ?? 'none'}`,
    `  output=${out ? JSON.stringify(out) : '<empty>'}`,
    `  visible=[${visible.join(',')}]`,
    `  hidden(on-but-absent)=[${hidden.join(',')}]`,
  ]);
}

async function main() {
  // Self-suppress a zombie bar left behind by an uninstalled plugin (before any
  // stdin read — matching the intent of install.js's now-dead `[ -f ]` guard).
  // Also clean up the stale session state so it doesn't linger after a
  // wrong-order `/plugin uninstall` (cache kept, /cc-cream:uninstall skipped).
  if (isOrphanedPluginRun(fileURLToPath(import.meta.url))) {
    try { fs.rmSync(PATHS.stateFile(), { force: true }); } catch { /* ignore */ }
    process.exit(0);
  }

  const raw = await readStdin();
  const data = parseSession(raw);
  const cfg = loadConfig(readConfigFile());
  const now = nowFromEnv(process.env);

  const sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null;
  const stateFile = PATHS.stateFile();
  const state = sessionId ? readState(stateFile) : {};
  const prevSessionState = getSessionState(state, sessionId);

  const ttlAnchorMs = resolveTtlAnchor(data, prevSessionState, now);
  const out = render(data, cfg, process.env, now, prevSessionState, ttlAnchorMs);
  if (out) process.stdout.write(`${out}\n`);

  if (debugEnabled(process.env)) {
    logDebug(process.env, { data, cfg, now, prevSessionState, sessionId, rawLen: raw.length, ttlAnchorMs, out });
  }

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
