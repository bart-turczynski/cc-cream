import fs from 'node:fs';
import { isNum, numOr } from './utils.js';

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
  try {
    fs.writeFileSync(stateFilePath, JSON.stringify(state));
  } catch {
    // degrade silently — stateless render is fine
  }
}

export function getSessionState(state, sessionId) {
  if (!sessionId || typeof sessionId !== 'string') return null;
  const sessions = state?.sessions;
  if (!sessions || typeof sessions !== 'object') return null;
  return sessions[sessionId] ?? null;
}

export function patchSessionState(state, sessionId, patch) {
  if (!sessionId || typeof sessionId !== 'string') return state;
  const sessions = { ...(state?.sessions ?? {}) };
  sessions[sessionId] = { ...(sessions[sessionId] ?? {}), ...patch };
  return { ...state, sessions };
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
