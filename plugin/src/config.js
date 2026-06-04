import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DEFAULTS } from './defaults.js';
import { clone, isNum, numOr } from './utils.js';

// Each normalizer is `(value, fallback) => value | fallback`: it returns the
// value when it's in-domain, else the fallback. The same table drives BOTH the
// forgiving merge (fallback = the default) and the --check-config doctor
// (fallback = a sentinel, so a returned sentinel means "rejected").
const boolOr = (v, d) => (typeof v === 'boolean' ? v : d);
const rowOr = (v, d) => (v === 1 || v === 2 || v === 3 ? v : d);
const posOr = (v, d) => (isNum(v) && v > 0 ? v : d); // a ceiling of 0/neg would divide-by-zero
const basisOr = (v, d) => (v === 'window' || v === 'ceiling' ? v : d);
const ctxDisplayOr = (v, d) => (v === 'basis' || v === 'window' ? v : d);
const hourOr = (v, d) => (isNum(v) && v >= 0 && v <= 23 ? v : d);
const percentageOr = (v, d) => (v === 'consumed' || v === 'remaining' ? v : d);
const numbersOr = (v, d) => (v === 'compact' || v === 'exact' ? v : d);

function ttlOr(v, d) {
  if (v === 'auto') return 'auto';
  if (v === 60 || v === '60') return 60;
  if (v === 5 || v === '5') return 5;
  return d;
}

// Top-level config keys and their normalizers (besides `segments`, handled below).
const TOP_LEVEL = {
  numbers: numbersOr,
  ttl: ttlOr,
  percentage: percentageOr,
};

// Per-segment field normalizers. The set of fields VALID for a given segment is
// that segment's own keys in DEFAULTS (so `ctx` accepts `ceiling`, `peak`
// accepts `start`/`end`, etc.); this table just says how each is normalized.
const SEGMENT_FIELDS = {
  on: boolOr,
  row: rowOr,
  order: numOr,
  amber: numOr,
  orange: numOr,
  red: numOr,
  drop: posOr,
  drop_recover: posOr,
  basis: basisOr,
  ceiling: posOr,
  display: ctxDisplayOr,
  start: hourOr,
  end: hourOr,
  lead: posOr,
};

function mergeConfig(parsed) {
  const cfg = clone(DEFAULTS);
  for (const [key, norm] of Object.entries(TOP_LEVEL)) {
    cfg[key] = norm(parsed[key], DEFAULTS[key]);
  }

  const segs = parsed.segments;
  if (segs && typeof segs === 'object' && !Array.isArray(segs)) {
    for (const id of Object.keys(DEFAULTS.segments)) {
      const def = DEFAULTS.segments[id];
      const s = segs[id];
      const out = clone(def);
      if (s && typeof s === 'object' && !Array.isArray(s)) {
        for (const field of Object.keys(def)) {
          const norm = SEGMENT_FIELDS[field];
          if (norm) out[field] = norm(s[field], def[field]);
        }
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

// Diagnose a parsed config object: report unknown keys and out-of-domain values
// using the same schema table the merge uses. Returns a list of human-readable
// problems (empty = clean). The runtime silently ignores these (per-field
// fallback); the doctor surfaces them so a typo'd key isn't a silent no-op.
export function checkConfig(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return ['cc-cream.json must be a JSON object.'];
  }
  const problems = [];
  const INVALID = Symbol('invalid');

  for (const key of Object.keys(parsed)) {
    if (key === 'segments') continue;
    const norm = TOP_LEVEL[key];
    if (!norm) {
      problems.push(`unknown top-level key: "${key}"`);
    } else if (norm(parsed[key], INVALID) === INVALID) {
      problems.push(`out-of-domain value for "${key}": ${JSON.stringify(parsed[key])}`);
    }
  }

  const segs = parsed.segments;
  if (segs !== undefined) {
    if (!segs || typeof segs !== 'object' || Array.isArray(segs)) {
      problems.push('"segments" must be an object.');
    } else {
      for (const id of Object.keys(segs)) {
        if (!(id in DEFAULTS.segments)) {
          problems.push(`unknown segment: "${id}"`);
          continue;
        }
        const s = segs[id];
        if (!s || typeof s !== 'object' || Array.isArray(s)) {
          problems.push(`segment "${id}" must be an object.`);
          continue;
        }
        const def = DEFAULTS.segments[id];
        for (const field of Object.keys(s)) {
          if (!(field in def)) {
            problems.push(`unknown field on "${id}": "${field}"`);
            continue;
          }
          const norm = SEGMENT_FIELDS[field];
          if (norm && norm(s[field], INVALID) === INVALID) {
            problems.push(`out-of-domain value for "${id}.${field}": ${JSON.stringify(s[field])}`);
          }
        }
      }
    }
  }
  return problems;
}

// Coerce a CLI string to the JS value a normalizer expects.
function coerceValue(str) {
  if (str === 'true') return true;
  if (str === 'false') return false;
  const n = Number(str);
  return !Number.isNaN(n) && str.trim() !== '' ? n : str;
}

// Validate and normalize a single dot-path assignment from the CLI.
// dotPath: "percentage" (top-level) or "ctx.ceiling" (segment.field).
// rawValue: the string the user passed; coerced before normalization.
// Returns { ok: true, value } or { ok: false, error }.
export function normalizeConfigField(dotPath, rawValue) {
  const INVALID = Symbol('invalid');
  const coerced = coerceValue(rawValue);
  const parts = dotPath.split('.');

  if (parts.length === 1) {
    const [key] = parts;
    const norm = TOP_LEVEL[key];
    if (!norm) return { ok: false, error: `unknown config key: "${key}"` };
    const v = norm(coerced, INVALID);
    if (v === INVALID) return { ok: false, error: `invalid value for "${key}": ${JSON.stringify(rawValue)}` };
    return { ok: true, value: v };
  }

  if (parts.length === 2) {
    const [segId, field] = parts;
    if (!DEFAULTS.segments[segId]) return { ok: false, error: `unknown segment: "${segId}"` };
    const segDef = DEFAULTS.segments[segId];
    if (!(field in segDef)) return { ok: false, error: `unknown field "${field}" on segment "${segId}"` };
    const norm = SEGMENT_FIELDS[field];
    if (!norm) return { ok: false, error: `unsettable field: "${field}"` };
    const v = norm(coerced, INVALID);
    if (v === INVALID) return { ok: false, error: `invalid value for "${segId}.${field}": ${JSON.stringify(rawValue)}` };
    return { ok: true, value: v };
  }

  return { ok: false, error: `invalid key path "${dotPath}" — use "key" for top-level or "segment.field" for per-segment` };
}

export function readConfigFile() {
  try {
    return fs.readFileSync(path.join(os.homedir(), '.claude', 'cc-cream.json'), 'utf8');
  } catch {
    return null;
  }
}
