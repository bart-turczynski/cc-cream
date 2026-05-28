import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS } from './defaults.js';
import { clone, isNum, numOr } from './utils.js';

const boolOr = (v, d) => (typeof v === 'boolean' ? v : d);
const rowOr = (v, d) => (v === 1 || v === 2 || v === 3 ? v : d);
const posOr = (v, d) => (isNum(v) && v > 0 ? v : d); // a ceiling of 0/neg would divide-by-zero
const basisOr = (v, d) => (v === 'window' || v === 'ceiling' ? v : d);
const ctxDisplayOr = (v, d) => (v === 'basis' || v === 'window' ? v : d);
const hourOr = (v, d) => (isNum(v) && v >= 0 && v <= 23 ? v : d);
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
        if ('drop' in def) out.drop = posOr(s.drop, def.drop);
        if ('drop_recover' in def) out.drop_recover = posOr(s.drop_recover, def.drop_recover);
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
    return clone(DEFAULTS);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return clone(DEFAULTS);
  return mergeConfig(parsed);
}

export function readConfigFile() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-cream.json'), 'utf8');
  } catch {
    return null;
  }
}
