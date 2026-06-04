import fs from 'node:fs';
import process from 'node:process';
import { isNum, numOr } from './utils.js';

// Cap on retained per-session entries. The state file gains one key per
// session_id and is never otherwise pruned, so without a cap it grows without
// bound. We keep the most-recently-touched sessions (by `ts`) and drop the rest.
const MAX_SESSIONS = 50;

// session_id is used as an object key. A value of __proto__/constructor/prototype
// would mutate the object's prototype instead of storing data; reject those so a
// crafted or poisoned id can't corrupt the session map.
const isUnsafeKey = (k) => k === '__proto__' || k === 'constructor' || k === 'prototype';

export function readState(stateFilePath) {
  try {
    const raw = fs.readFileSync(stateFilePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    return {};
  } catch {
    return {};
  }
}

export function writeState(stateFilePath, state) {
  // Atomic write: a direct writeFileSync interrupted mid-write (crash, ENOSPC)
  // would truncate the state file. Write a sibling temp file, then rename over
  // the target (atomic within a filesystem; the temp shares the target's dir so
  // the rename never crosses devices). State is regenerable, so any failure
  // degrades silently — a stateless render is fine.
  const tmp = `${stateFilePath}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, stateFilePath);
  } catch {
    try { fs.rmSync(tmp, { force: true }); } catch {}
  }
}

export function getSessionState(state, sessionId) {
  if (!sessionId || typeof sessionId !== 'string' || isUnsafeKey(sessionId)) return null;
  const sessions = state?.sessions;
  if (!sessions || typeof sessions !== 'object') return null;
  return Object.hasOwn(sessions, sessionId) ? sessions[sessionId] : null;
}

// Keep at most MAX_SESSIONS entries, evicting the lowest `ts` (oldest touched)
// first. Sessions without a numeric ts sort oldest.
function prune(sessions) {
  const keys = Object.keys(sessions);
  if (keys.length <= MAX_SESSIONS) return sessions;
  const keep = keys
    .sort((a, b) => numOr(sessions[b]?.ts, 0) - numOr(sessions[a]?.ts, 0))
    .slice(0, MAX_SESSIONS);
  const out = {};
  for (const k of keep) out[k] = sessions[k];
  return out;
}

export function patchSessionState(state, sessionId, patch) {
  if (!sessionId || typeof sessionId !== 'string' || isUnsafeKey(sessionId)) return state;
  const sessions = { ...(state?.sessions ?? {}) };
  sessions[sessionId] = { ...(sessions[sessionId] ?? {}), ...patch };
  return { ...state, sessions: prune(sessions) };
}

export function nextSessionPatch(data, prevSessionState, cfg, now) {
  const patch = { ts: now };
  const cost = data?.cost?.total_cost_usd;
  if (isNum(cost)) patch.cost = cost;
  const cu = data?.context_window?.current_usage;
  if (cu && typeof cu === 'object') {
    const read = numOr(cu.cache_read_input_tokens, 0);
    const denom = read + numOr(cu.cache_creation_input_tokens, 0) + numOr(cu.input_tokens, 0);
    if (denom > 0) {
      const currentCachePct = Math.round((read / denom) * 100);
      patch.cache_pct = currentCachePct;
      const prevCachePct = prevSessionState && isNum(prevSessionState.cache_pct) ? prevSessionState.cache_pct : undefined;
      const wasRecovering = prevSessionState?.recovering === true;
      const freshDrop = isNum(prevCachePct) && (prevCachePct - currentCachePct) >= cfg.segments.cache.drop;
      patch.recovering = freshDrop || (wasRecovering && currentCachePct < cfg.segments.cache.drop_recover);
    }
  }
  const fh = data?.rate_limits?.five_hour;
  if (fh && isNum(fh.used_percentage)) patch.five_hour_pct = fh.used_percentage;
  const curTokens = data?.context_window?.total_input_tokens;
  const prevTokens = prevSessionState?.total_input_tokens;
  if (isNum(curTokens)) {
    patch.total_input_tokens = curTokens;
    if (isNum(prevTokens) && curTokens > prevTokens) patch.last_api_ts = now;
  }
  return patch;
}
