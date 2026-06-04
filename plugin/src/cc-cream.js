#!/usr/bin/env node
// cc-cream — Claude Code status-line engine.
// Reads the session JSON Claude Code pipes on stdin and prints a colored
// <=3-row bar. Hard rule: degrade, never crash.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadConfig, readConfigFile } from './config.js';
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
  const file = env.CC_CREAM_DEBUG_LOG || path.join(os.homedir(), '.claude', 'cc-cream-debug.log');
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

// --- Ghost-bar self-defense (CREAM-uchemxln) --------------------------------
// No Claude Code host removal path deletes our statusLine OR the version cache:
// `/plugin uninstall` and `/plugin marketplace remove` both leave the cache tree
// AND the statusLine in settings.json. So a plugin-cache copy of this renderer
// keeps executing every session after the plugin is gone — a zombie bar the user
// has no in-product way to stop (`/cc-cream:uninstall` deregisters with the
// plugin). The shell `[ -f entrypoint ] || exit 0` guard in install.js can't
// cover this: the cache it checks for is never GC'd, so the file never goes
// missing. The reliable signal is the host registry, not the filesystem — when we
// detect we're running FROM the plugin cache, confirm cc-cream is still listed in
// installed_plugins.json; if it's gone, exit 0 silently.

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// If `selfPath` lives under `<root>/plugins/cache/<marketplace>/<plugin>/...`,
// return { pluginsDir, pluginHome }; otherwise null (a manual/dev install, which
// is never a cache orphan). Both paths are derived from the running location, so
// the registry we consult is the one that actually governs THIS install — no
// os.homedir()/CLAUDE_CONFIG_DIR assumption.
function pluginCacheLocation(selfPath) {
  const segs = realpathOr(selfPath).split(path.sep);
  for (let i = 0; i + 3 < segs.length; i++) {
    if (segs[i] === 'plugins' && segs[i + 1] === 'cache') {
      return {
        pluginsDir: segs.slice(0, i + 1).join(path.sep),
        pluginHome: segs.slice(0, i + 4).join(path.sep),
      };
    }
  }
  return null;
}

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// True when this renderer is a plugin-cache orphan: running from the cache while
// cc-cream is absent from the host's installed_plugins.json. Cost is one tiny
// read, and ONLY on the plugin-cache path — manual/dev installs return early
// before touching the disk. A missing registry (ENOENT) counts as orphaned; any
// other read/parse failure is treated as not-orphaned, so a transient glitch can
// never suppress a legitimately wired bar.
function isOrphanedPluginRun(selfPath) {
  const loc = pluginCacheLocation(selfPath);
  if (!loc) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(loc.pluginsDir, 'installed_plugins.json'), 'utf8'));
  } catch (err) {
    return err?.code === 'ENOENT';
  }
  const plugins = parsed && typeof parsed === 'object' ? parsed.plugins : null;
  if (!plugins || typeof plugins !== 'object') return true;
  const home = realpathOr(loc.pluginHome);
  for (const entries of Object.values(plugins)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry.installPath === 'string' && isWithin(home, realpathOr(entry.installPath))) {
        return false; // an installed cc-cream entry lives in our cache subtree
      }
    }
  }
  return true;
}

async function main() {
  // Self-suppress a zombie bar left behind by an uninstalled plugin (before any
  // stdin read — matching the intent of install.js's now-dead `[ -f ]` guard).
  // Also clean up the stale session state so it doesn't linger after a
  // wrong-order `/plugin uninstall` (cache kept, /cc-cream:uninstall skipped).
  if (isOrphanedPluginRun(fileURLToPath(import.meta.url))) {
    try { fs.rmSync(path.join(os.homedir(), '.claude', 'cc-cream-state.json'), { force: true }); } catch { /* ignore */ }
    process.exit(0);
  }

  const raw = await readStdin();
  const data = parseSession(raw);
  const cfg = loadConfig(readConfigFile());
  const now = nowFromEnv(process.env);

  const sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null;
  const stateFile = path.join(os.homedir(), '.claude', 'cc-cream-state.json');
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
