#!/usr/bin/env node
// cc-cream — Claude Code status-line engine.
// Single file, Node built-ins only, ESM. Reads the session JSON Claude Code
// pipes on stdin and prints a colored <=2-row bar. The model never sees the
// output, so it costs zero tokens. Spec of record: docs/PRD.md (v2 + §14).
//
// Hard rule: degrade, never crash. Malformed/empty stdin or config -> exit 0,
// hide the affected segment, per-field fallback to built-in defaults.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Built-in defaults (PRD §6, minus the dropped `width` key — §14.2).
// Each colored segment names the LOWER BOUND where a color begins; the color
// function tests `red` first, then `orange` (ctx only), then `amber`, else green.
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  numbers: 'compact',     // 'compact' | 'exact'
  ttl: 'auto',            // 'auto' | 60 | 5
  percentage: 'consumed', // 'consumed' | 'remaining' — display-only flip of ctx/5h/7d (PRDv2 §3)
  segments: {
    model:    { on: true,  row: 1, order: 1 },
    // `basis` picks the fullness reference the color (and, by default, the
    // shown %) measures against: 'window' = used_percentage of the real window
    // (no-regression default); 'ceiling' = total_input_tokens / `ceiling`, so
    // the warning fires at a fixed absolute size on any window. `display`
    // governs the shown %: 'basis' tracks the coloring basis (number and color
    // agree), 'window' pins it to CC's window figure regardless (PRD §4.4).
    ctx:      { on: true,  row: 1, order: 2, amber: 30, orange: 40, red: 50, basis: 'window', ceiling: 200000, display: 'basis' },
    cache:    { on: true,  row: 1, order: 3 },
    idle:     { on: true,  row: 1, order: 4, amber: 50, red: 80 },
    cost:     { on: true,  row: 1, order: 5 },
    '5h':     { on: true,  row: 2, order: 1, amber: 75, red: 90 },
    '7d':     { on: true,  row: 2, order: 2, amber: 75, red: 90 },
    // peak: amber "peak" word during Anthropic's faster-drain window (PRDv2 §2).
    // start/end are Pacific-time hours (0–23, exclusive end); weekday (Mon–Fri)
    // and the America/Los_Angeles timezone are hardcoded policy facts, not config.
    peak:     { on: true,  row: 2, order: 3, start: 5, end: 11 },
    effort:   { on: false, row: 1, order: 6 },
    thinking: { on: false, row: 1, order: 7 },
  },
};

// Row 1 renders as up-to-three visual zones separated by " | " (PRD §4.3):
// [model] | [session metrics] | [cost]. Empty zones drop out, so a model-only
// bar is just the name with no separators.
const ROW1_ZONES = [['model'], ['ctx', 'cache', 'idle', 'effort', 'thinking'], ['cost']];

const ANSI = { red: '\x1b[31m', green: '\x1b[32m', amber: '\x1b[33m', orange: '\x1b[38;5;208m' };

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------
// Config loading — strict JSON, per-field fallback, whole-file fallback.
// ---------------------------------------------------------------------------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOr = (v, d) => (isNum(v) ? v : d);
const boolOr = (v, d) => (typeof v === 'boolean' ? v : d);
const rowOr = (v, d) => (v === 1 || v === 2 ? v : d);
const posOr = (v, d) => (isNum(v) && v > 0 ? v : d); // a ceiling of 0/neg would divide-by-zero
const basisOr = (v, d) => (v === 'window' || v === 'ceiling' ? v : d);
const ctxDisplayOr = (v, d) => (v === 'basis' || v === 'window' ? v : d);
const hourOr = (v, d) => (isNum(v) && v >= 0 && v <= 23 ? v : d); // PT hour for the peak window
const percentageOr = (v, d) => (v === 'consumed' || v === 'remaining' ? v : d);

function ttlOr(v, d) {
  if (v === 'auto') return 'auto';
  if (v === 60 || v === '60') return 60;
  if (v === 5 || v === '5') return 5;
  return d;
}

function mergeConfig(parsed) {
  const cfg = clone(DEFAULTS);
  cfg.numbers = parsed.numbers === 'compact' || parsed.numbers === 'exact' ? parsed.numbers : DEFAULTS.numbers;
  cfg.ttl = ttlOr(parsed.ttl, DEFAULTS.ttl);
  cfg.percentage = percentageOr(parsed.percentage, DEFAULTS.percentage);

  const segs = parsed.segments;
  if (segs && typeof segs === 'object' && !Array.isArray(segs)) {
    for (const id of Object.keys(DEFAULTS.segments)) {
      const def = DEFAULTS.segments[id];
      const s = segs[id];
      const out = clone(def);
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        out.on = boolOr(s.on, def.on);
        out.row = rowOr(s.row, def.row);
        out.order = numOr(s.order, def.order);
        if ('amber' in def) out.amber = numOr(s.amber, def.amber);
        if ('orange' in def) out.orange = numOr(s.orange, def.orange);
        if ('red' in def) out.red = numOr(s.red, def.red);
        if ('basis' in def) out.basis = basisOr(s.basis, def.basis);
        if ('ceiling' in def) out.ceiling = posOr(s.ceiling, def.ceiling);
        if ('display' in def) out.display = ctxDisplayOr(s.display, def.display);
        if ('start' in def) out.start = hourOr(s.start, def.start);
        if ('end' in def) out.end = hourOr(s.end, def.end);
      }
      cfg.segments[id] = out;
    }
  }
  return cfg;
}

// raw === null/undefined (no file) -> all defaults. Parse error -> all defaults.
export function loadConfig(raw) {
  if (raw == null) return clone(DEFAULTS);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return clone(DEFAULTS); // whole-file fallback (e.g. hand-edit trailing comma)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clone(DEFAULTS);
  return mergeConfig(parsed);
}

function readConfigFile() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-cream.json'), 'utf8');
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// TTL inference for the idle segment's coloring (PRD §9).
// ---------------------------------------------------------------------------
const envOn = (v) => typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

function hasWindow(rl) {
  return !!(rl && typeof rl === 'object' && (rl.five_hour || rl.seven_day));
}

function overCap(rl) {
  return [rl.five_hour, rl.seven_day].some((w) => w && numOr(w.used_percentage, 0) >= 100);
}

export function resolveTtl({ rateLimits, config, env }) {
  const e = env || {};
  // FORCE override wins over everything (PRD §10).
  if (envOn(e.FORCE_PROMPT_CACHING_5M)) return 5;
  // Explicit config pin.
  const pin = config ? config.ttl : 'auto';
  if (pin === 5) return 5;
  if (pin === 60) return 60;
  // auto resolution.
  if (hasWindow(rateLimits)) {
    return overCap(rateLimits) ? 5 : 60; // subscriber
  }
  return envOn(e.ENABLE_PROMPT_CACHING_1H) ? 60 : 5; // API user
}

// ---------------------------------------------------------------------------
// Formatting helpers.
// ---------------------------------------------------------------------------
function fmtNum(n, mode) {
  if (mode === 'exact') return String(n);
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

const pad2 = (n) => String(n).padStart(2, '0');

function paint(text, color) {
  return color && ANSI[color] ? `${ANSI[color]}${text}\x1b[0m` : text;
}

// 3-arg form: band(value, amber, red) — used by idle / rate limits.
// 4-arg form: band(value, amber, orange, red) — used by ctx.
// Orange is skipped when it falls at or below amber (guards against a user config
// that sets amber higher than the default orange without explicitly clearing it).
function band(value, amber, orangeOrRed, red) {
  if (red === undefined) { red = orangeOrRed; orangeOrRed = undefined; }
  if (value >= red) return 'red';
  if (orangeOrRed !== undefined && orangeOrRed > amber && value >= orangeOrRed) return 'orange';
  if (value >= amber) return 'amber';
  return 'green';
}

// Normalize a resets_at value to epoch ms. Claude Code sends a Unix timestamp
// in SECONDS (confirmed via the S0 golden fixture); also tolerate ms and ISO.
function toEpochMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return toEpochMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

// Display-only percentage flip (PRDv2 §3). `remaining` shows 100 − consumed for
// the budget/occupancy segments (ctx, 5h, 7d). Color always derives from the
// consumed figure upstream, so only the shown number changes here.
const flipPct = (consumedShown, cfg) => (cfg.percentage === 'remaining' ? 100 - consumedShown : consumedShown);

// True during Anthropic's faster-drain "peak" window (PRDv2 §2): a weekday
// (Mon–Fri) within [start, end) Pacific-time hours. `now` is epoch ms; `tz`
// defaults to the hardcoded America/Los_Angeles policy reference (overridable
// only as a test seam). Intl handles PST/PDT; if it throws, return false (hide).
export function isPeak(now, cfg, tz = 'America/Los_Angeles') {
  const s = cfg?.segments?.peak ?? {};
  const start = isNum(s.start) ? s.start : 5;
  const end = isNum(s.end) ? s.end : 11;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour: 'numeric', hour12: false, weekday: 'short',
    }).formatToParts(new Date(now));
    const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
    const hour = Number(p.hour) % 24; // some ICU builds emit "24" for midnight
    return !['Sat', 'Sun'].includes(p.weekday) && hour >= start && hour < end;
  } catch {
    return false;
  }
}

// resets_at - now, on the §4.4 format ladder: >=1d -> "Fri 23:45", >=1h -> HhMMm, else MMm.
export function countdown(resetsAt, now) {
  const t = toEpochMs(resetsAt);
  if (Number.isNaN(t)) return '';
  const totalMin = Math.max(0, Math.floor((t - now) / 60000));
  const days = Math.floor(totalMin / 1440);
  if (days >= 1) {
    const d = new Date(t);
    const weekday = d.toLocaleDateString(undefined, { weekday: 'short' });
    const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${weekday} ${time}`;
  }
  const hours = Math.floor(totalMin / 60);
  if (hours >= 1) return `${hours}h${pad2(totalMin % 60)}m`;
  return `${totalMin}m`;
}

// ---------------------------------------------------------------------------
// Segment renderers — each returns { text, color } or null (hidden).
// ---------------------------------------------------------------------------
function magnitudeTokens(cw) {
  // PRD §4.1 assumes `total_input_tokens` (S0 confirms the real name); fall back
  // to the input-only sum of current_usage so the magnitude survives a rename.
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

  // Fullness reference for coloring (PRD §4.4). basis 'ceiling' measures the
  // input-token magnitude against a fixed token ceiling, so the warning fires
  // at the same absolute size regardless of window. It degrades to the window
  // basis when the magnitude is unavailable (per-field fallback to default).
  let colorPct = winPct;
  let ceilingPct;
  if (s.basis === 'ceiling' && isNum(mag) && s.ceiling > 0) {
    ceilingPct = (mag / s.ceiling) * 100;
    colorPct = ceilingPct;
  }

  // Shown %: tracks the basis so the number and color agree; the 'window'
  // display override pins it to CC's window figure even under the ceiling basis.
  const shownPct = ceilingPct != null && s.display !== 'window' ? ceilingPct : winPct;

  let text = `ctx:${flipPct(Math.round(shownPct), cfg)}%`;
  if (isNum(mag)) text += ` (${fmtNum(mag, cfg.numbers)})`; // magnitude is absolute, never flips
  return { text, color: band(colorPct, s.amber, s.orange, s.red) };
}

function segCache(data) {
  const u = data?.context_window?.current_usage;
  if (!u || typeof u !== 'object') return null; // null right after /compact
  const read = numOr(u.cache_read_input_tokens, 0);
  const denom = read + numOr(u.cache_creation_input_tokens, 0) + numOr(u.input_tokens, 0);
  if (denom <= 0) return null;
  return { text: `cache:${Math.round((read / denom) * 100)}%`, color: null };
}

function segIdle(data, cfg, ttlMin, now) {
  const tp = data?.transcript_path;
  if (typeof tp !== 'string' || tp === '') return null;
  let mtimeMs;
  try {
    mtimeMs = fs.statSync(tp).mtimeMs;
  } catch {
    return null; // hide rather than show a false "cache warm" idle:00:00
  }
  const min = Math.floor(Math.max(0, now - mtimeMs) / 60000);
  const text = `idle:${pad2(Math.floor(min / 60))}:${pad2(min % 60)}`;
  const s = cfg.segments.idle;
  const pctTtl = ttlMin > 0 ? (min / ttlMin) * 100 : 0;
  return { text, color: band(pctTtl, s.amber, s.red) };
}

function segCost(data) {
  const c = data?.cost?.total_cost_usd;
  if (!isNum(c) || c <= 0) return null; // auto-hide zero/absent
  return { text: `~$${c.toFixed(2)}`, color: null };
}

function segRate(window, label, cfg, segId, now) {
  if (!window || typeof window !== 'object') return null;
  const pct = window.used_percentage;
  if (!isNum(pct)) return null;
  const s = cfg.segments[segId];
  const color = pct >= s.red ? 'red' : pct >= s.amber ? 'amber' : null; // neutral below amber
  // PRDv2 §1: prefix the reset countdown with ↺ so the figure reads unambiguously
  // as "time until a fresh 100%", not elapsed time. Drop the countdown (and the
  // glyph, and the "·" joiner) when resets_at is missing/unparseable — show just
  // the percentage rather than a dangling separator. Degrade, never crash.
  const cd = countdown(window.resets_at, now);
  const head = `${label}:${flipPct(Math.round(pct), cfg)}%`;
  const text = cd ? `${head}·↺${cd}` : head;
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

function segPeak(data, cfg, now, tz) {
  // peak rides the account-budget row, so it shows only when that row has windows;
  // an API user (no rate_limits) whose Row 2 collapses gets no peak either (PRDv2 §5).
  if (!hasWindow(data?.rate_limits)) return null;
  if (!isPeak(now, cfg, tz)) return null;
  return { text: 'peak', color: 'amber' };
}

// ---------------------------------------------------------------------------
// Render — assemble enabled+visible segments into up to two rows.
// ---------------------------------------------------------------------------
export function render(data, cfg, env, now) {
  const ttlMin = resolveTtl({ rateLimits: data?.rate_limits, config: cfg, env });
  // The peak timezone is hardcoded policy (PRDv2 §2); CC_CREAM_TZ is an internal
  // test/diagnostic seam, not a documented config key.
  const tz = (env && env.CC_CREAM_TZ) || 'America/Los_Angeles';
  const segs = {
    model: segModel(data),
    ctx: segCtx(data, cfg),
    cache: segCache(data),
    idle: segIdle(data, cfg, ttlMin, now),
    cost: segCost(data),
    '5h': segRate(data?.rate_limits?.five_hour, '5h', cfg, '5h', now),
    '7d': segRate(data?.rate_limits?.seven_day, '7d', cfg, '7d', now),
    peak: segPeak(data, cfg, now, tz),
    effort: segEffort(data),
    thinking: segThinking(data),
  };

  const visible = (id, row) => cfg.segments[id]?.on && segs[id] && cfg.segments[id].row === row;
  const byOrder = (a, b) => cfg.segments[a].order - cfg.segments[b].order;
  const draw = (id) => paint(segs[id].text, segs[id].color);

  // Row 1: zoned, " | " between zones, " " within a zone.
  const row1 = ROW1_ZONES.map((zone) => zone.filter((id) => visible(id, 1)).sort(byOrder).map(draw).join(' '))
    .filter((z) => z.length > 0)
    .join(' | ');

  // Row 2: any segment configured to row 2, "  " between segments.
  const row2 = Object.keys(cfg.segments)
    .filter((id) => visible(id, 2))
    .sort(byOrder)
    .map(draw)
    .join('  ');

  return [row1, row2].filter((r) => r.length > 0).join('\n');
}

// ---------------------------------------------------------------------------
// Per-session state — ~/.claude/cc-cream-state.json (keyed by session_id).
// Both read and write degrade silently on any error (PRD §8).
// Shape: { sessions: { [id]: { cost?, cache_pct?, ts } } }
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Entry point.
// ---------------------------------------------------------------------------
async function readStdin() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  let data = {};
  try {
    const parsed = JSON.parse(await readStdin());
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {
    // malformed/empty stdin -> render with no data -> empty bar
  }
  const cfg = loadConfig(readConfigFile());
  // CC_CREAM_NOW (epoch ms) pins the clock — an internal test/diagnostic seam for
  // deterministic peak/countdown rendering; absent in normal use → real time.
  const rawNow = process.env.CC_CREAM_NOW;
  const now = rawNow && Number.isFinite(Number(rawNow)) ? Number(rawNow) : Date.now();
  const out = render(data, cfg, process.env, now);
  if (out) process.stdout.write(`${out}\n`);

  // Persist per-session state for consumer features (drop-detection, cost-delta,
  // burn-rate). Skip when session_id is absent; degrade silently on I/O errors.
  const sessionId = typeof data.session_id === 'string' && data.session_id ? data.session_id : null;
  if (sessionId) {
    const stateFile = path.join(os.homedir(), '.claude', 'cc-cream-state.json');
    const state = readState(stateFile);
    const patch = { ts: now };
    const cost = data?.cost?.total_cost_usd;
    if (isNum(cost)) patch.cost = cost;
    const cu = data?.context_window?.current_usage;
    if (cu && typeof cu === 'object') {
      const read = numOr(cu.cache_read_input_tokens, 0);
      const denom = read + numOr(cu.cache_creation_input_tokens, 0) + numOr(cu.input_tokens, 0);
      if (denom > 0) patch.cache_pct = Math.round((read / denom) * 100);
    }
    writeState(stateFile, patchSessionState(state, sessionId, patch));
  }

  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
