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
// function tests `red` first, then `amber`, else neutral/green.
// ---------------------------------------------------------------------------
export const DEFAULTS = {
  numbers: 'compact', // 'compact' | 'exact'
  ttl: 'auto',        // 'auto' | 60 | 5
  segments: {
    model:    { on: true,  row: 1, order: 1 },
    ctx:      { on: true,  row: 1, order: 2, amber: 25, red: 40 },
    cache:    { on: true,  row: 1, order: 3 },
    idle:     { on: true,  row: 1, order: 4, amber: 50, red: 80 },
    cost:     { on: true,  row: 1, order: 5 },
    '5h':     { on: true,  row: 2, order: 1, amber: 75, red: 90 },
    '7d':     { on: true,  row: 2, order: 2, amber: 75, red: 90 },
    effort:   { on: false, row: 1, order: 6 },
    thinking: { on: false, row: 1, order: 7 },
  },
};

// Row 1 renders as up-to-three visual zones separated by " | " (PRD §4.3):
// [model] | [session metrics] | [cost]. Empty zones drop out, so a model-only
// bar is just the name with no separators.
const ROW1_ZONES = [['model'], ['ctx', 'cache', 'idle', 'effort', 'thinking'], ['cost']];

const ANSI = { red: 31, green: 32, amber: 33 };

const clone = (o) => JSON.parse(JSON.stringify(o));

// ---------------------------------------------------------------------------
// Config loading — strict JSON, per-field fallback, whole-file fallback.
// ---------------------------------------------------------------------------
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const numOr = (v, d) => (isNum(v) ? v : d);
const boolOr = (v, d) => (typeof v === 'boolean' ? v : d);
const rowOr = (v, d) => (v === 1 || v === 2 ? v : d);

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
        if ('red' in def) out.red = numOr(s.red, def.red);
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
  return color && ANSI[color] ? `\x1b[${ANSI[color]}m${text}\x1b[0m` : text;
}

function band(value, amber, red) {
  if (value >= red) return 'red';
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

// resets_at - now, on the §4.4 format ladder: >=1d -> Nd, >=1h -> HhMMm, else MMm.
function countdown(resetsAt, now) {
  const t = toEpochMs(resetsAt);
  if (Number.isNaN(t)) return '';
  const totalMin = Math.max(0, Math.floor((t - now) / 60000));
  const days = Math.floor(totalMin / 1440);
  if (days >= 1) return `${days}d`;
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
  const pct = cw.used_percentage;
  if (!isNum(pct)) return null;
  let text = `ctx:${Math.round(pct)}%`;
  const mag = magnitudeTokens(cw);
  if (isNum(mag)) text += ` (${fmtNum(mag, cfg.numbers)})`;
  const s = cfg.segments.ctx;
  return { text, color: band(pct, s.amber, s.red) };
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
  return { text: `${label}:${Math.round(pct)}%·${countdown(window.resets_at, now)}`, color };
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

// ---------------------------------------------------------------------------
// Render — assemble enabled+visible segments into up to two rows.
// ---------------------------------------------------------------------------
export function render(data, cfg, env, now) {
  const ttlMin = resolveTtl({ rateLimits: data?.rate_limits, config: cfg, env });
  const segs = {
    model: segModel(data),
    ctx: segCtx(data, cfg),
    cache: segCache(data),
    idle: segIdle(data, cfg, ttlMin, now),
    cost: segCost(data),
    '5h': segRate(data?.rate_limits?.five_hour, '5h', cfg, '5h', now),
    '7d': segRate(data?.rate_limits?.seven_day, '7d', cfg, '7d', now),
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
  const out = render(data, cfg, process.env, Date.now());
  if (out) process.stdout.write(`${out}\n`);
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
