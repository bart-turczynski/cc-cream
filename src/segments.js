import { band, countdown, flipPct, fmtNum, isNum, localHM, numOr, pad2, peakStatus } from './utils.js';
import { hasWindow } from './ttl.js';

function magnitudeTokens(cw) {
  // PRD §4.1 assumes `total_input_tokens`; fall back to the input-only sum of
  // current_usage so the magnitude survives a rename.
  if (isNum(cw.total_input_tokens)) return cw.total_input_tokens;
  const u = cw.current_usage;
  if (u && typeof u === 'object') {
    const sum = numOr(u.cache_read_input_tokens, 0) + numOr(u.cache_creation_input_tokens, 0) + numOr(u.input_tokens, 0);
    if (sum > 0) return sum;
  }
  return undefined;
}

function segModel(data) {
  const v = data?.model?.display_name;
  if (typeof v !== 'string' || v === '') return null;
  return { text: v, color: null };
}

function segCtx(data, cfg) {
  const cw = data?.context_window;
  if (!cw || typeof cw !== 'object') return null;
  const winPct = cw.used_percentage;
  if (!isNum(winPct)) return null;
  const s = cfg.segments.ctx;
  const mag = magnitudeTokens(cw);

  let colorPct = winPct;
  let ceilingPct;
  if (s.basis === 'ceiling' && isNum(mag) && s.ceiling > 0) {
    ceilingPct = (mag / s.ceiling) * 100;
    colorPct = ceilingPct;
  }

  const shownPct = ceilingPct != null && s.display !== 'window' ? ceilingPct : winPct;

  let text = `ctx:${flipPct(Math.round(shownPct), cfg)}%`;
  if (isNum(mag)) text += ` [${fmtNum(mag, cfg.numbers)}]`;
  return { text, color: band(colorPct, s.amber, s.orange, s.red) };
}

function segCache(data, cfg, prevCachePct, recovering) {
  const u = data?.context_window?.current_usage;
  if (!u || typeof u !== 'object') return null;
  const read = numOr(u.cache_read_input_tokens, 0);
  const denom = read + numOr(u.cache_creation_input_tokens, 0) + numOr(u.input_tokens, 0);
  if (denom <= 0) return null;
  const pct = Math.round((read / denom) * 100);
  const s = cfg.segments.cache;
  const freshDrop = isNum(prevCachePct) && (prevCachePct - pct) >= s.drop;
  const stillRecovering = recovering === true && pct < s.drop_recover;
  const color = (freshDrop || stillRecovering) ? 'red' : null;
  return { text: `cache:${pct}%`, color };
}

// Pure: the TTL anchor (when the cache window last reset) is resolved upstream in
// the I/O layer — see resolveTtlAnchor() in cc-cream.js — and injected as
// `anchorMs`, so this segment does no filesystem access. A null anchor (no token
// growth, no last_api_ts, no readable transcript) hides the segment.
function segTtl(cfg, ttlMin, now, anchorMs) {
  if (!isNum(anchorMs)) return null;
  const elapsedMin = Math.floor(Math.max(0, now - anchorMs) / 60000);
  const remainingMin = Math.max(0, ttlMin - elapsedMin);
  const text = `ttl:${remainingMin}`;
  const s = cfg.segments.ttl;
  const pctTtl = ttlMin > 0 ? (elapsedMin / ttlMin) * 100 : 0;
  return { text, color: band(pctTtl, s.amber, s.red) };
}

function segCost(data) {
  const c = data?.cost?.total_cost_usd;
  if (!isNum(c) || c <= 0) return null;
  return { text: `~$${c.toFixed(2)}`, color: null };
}

function segRate(window, label, cfg, segId, now) {
  if (!window || typeof window !== 'object') return null;
  const pct = window.used_percentage;
  if (!isNum(pct)) return null;
  const s = cfg.segments[segId];
  const color = pct >= s.red ? 'red' : pct >= s.amber ? 'amber' : null;
  const cd = countdown(window.resets_at, now);
  const head = `${label}:${flipPct(Math.round(pct), cfg)}%`;
  const text = cd ? `${head} ↺ ${cd}` : head;
  return { text, color };
}

function segEffort(data) {
  const lvl = data?.effort?.level;
  if (typeof lvl !== 'string' || lvl === '') return null;
  return { text: `effort:${lvl}`, color: null };
}

function segThinking(data) {
  const t = data?.thinking?.enabled;
  if (typeof t !== 'boolean') return null;
  return { text: `think:${t ? 'on' : 'off'}`, color: null };
}

function segApiRatio(data) {
  const api = data?.cost?.total_api_duration_ms;
  const total = data?.cost?.total_duration_ms;
  if (!isNum(api) || !isNum(total) || total <= 0) return null;
  const pct = Math.round(Math.min(100, (api / total) * 100));
  return { text: `∿ api:${pct}%`, color: null };
}

function segSessionName(data) {
  const name = data?.session_name;
  if (typeof name !== 'string' || name === '') return null;
  return { text: name, color: null };
}

function segCacheWrite(data) {
  const u = data?.context_window?.current_usage;
  if (!u || typeof u !== 'object') return null;
  const creation = numOr(u.cache_creation_input_tokens, 0);
  const denom = creation + numOr(u.cache_read_input_tokens, 0) + numOr(u.input_tokens, 0);
  if (denom <= 0) return null;
  return { text: `write:${Math.round((creation / denom) * 100)}%`, color: null };
}

function segPeak(data, cfg, now, tz) {
  // peak rides the account-budget row, so it shows only when that row has windows.
  if (!hasWindow(data?.rate_limits)) return null;
  const st = peakStatus(now, cfg, tz);
  if (!st) return null;
  const text = st.state === 'approaching'
    ? `peak in ${st.startsInMin}m`        // counting down to the window opening
    : `peak until ${localHM(st.endsAtMs)}`; // inside it: local clock time it closes
  return { text, color: 'amber' };
}

function segBurn(fiveHour, prev, now) {
  if (!fiveHour || !isNum(fiveHour.used_percentage)) return null;
  if (!prev || !isNum(prev.five_hour_pct) || !isNum(prev.ts)) return null;
  const deltaPct = fiveHour.used_percentage - prev.five_hour_pct;
  const deltaMs = now - prev.ts;
  if (deltaPct <= 0 || deltaMs <= 0) return null;
  const remaining = 100 - fiveHour.used_percentage;
  if (remaining <= 0) return null;
  const minEta = Math.ceil((remaining / deltaPct) * deltaMs / 60000);
  if (!Number.isFinite(minEta) || minEta >= 300) return null;
  const h = Math.floor(minEta / 60);
  const m = minEta % 60;
  return { text: h >= 1 ? `~${h}h${pad2(m)}m` : `~${minEta}m`, color: null };
}

export function renderSegments(data, cfg, ttlMin, now, prevSessionState = null, tz = 'America/Los_Angeles', ttlAnchorMs = null) {
  return {
    model: segModel(data),
    ctx: segCtx(data, cfg),
    cache: segCache(
      data,
      cfg,
      prevSessionState && isNum(prevSessionState.cache_pct) ? prevSessionState.cache_pct : undefined,
      prevSessionState?.recovering === true,
    ),
    ttl: segTtl(cfg, ttlMin, now, ttlAnchorMs),
    cost: segCost(data),
    '5h': segRate(data?.rate_limits?.five_hour, '5h', cfg, '5h', now),
    '7d': segRate(data?.rate_limits?.seven_day, '7d', cfg, '7d', now),
    peak: segPeak(data, cfg, now, tz),
    burn: segBurn(data?.rate_limits?.five_hour, prevSessionState, now),
    effort: segEffort(data),
    thinking: segThinking(data),
    api_ratio: segApiRatio(data),
    session_name: segSessionName(data),
    write: segCacheWrite(data),
  };
}
