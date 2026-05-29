import { realpathSync } from 'node:fs';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ANSI } from './defaults.js';

// Robust "is this module the process entrypoint?" check, shared by every module
// that may run both as a script and as an import (cc-cream.js, install.js). Node's
// ESM loader canonicalizes import.meta.url (symlinks resolved) but leaves
// process.argv[1] as-invoked, so a plain href comparison fails when the module runs
// from a symlinked path — e.g. a ~/.claude managed by a dotfile manager
// (stow/chezmoi/yadm) or synced via iCloud/Dropbox — silently skipping main().
// Comparing realpaths fixes it; falls back to the href compare if realpath throws
// (e.g. a path that no longer exists). Pass the caller's import.meta.url.
export function isEntrypoint(metaUrl, arg = process.argv[1]) {
  if (!arg) return false;
  try {
    return realpathSync(fileURLToPath(metaUrl)) === realpathSync(arg);
  } catch {
    return metaUrl === pathToFileURL(arg).href;
  }
}

export const clone = (o) => JSON.parse(JSON.stringify(o));
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
export const numOr = (v, d) => (isNum(v) ? v : d);
export const pad2 = (n) => String(n).padStart(2, '0');

export function fmtNum(n, mode) {
  if (mode === 'exact') return String(n);
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(n);
}

// Strip C0/C1 control characters (incl. ESC, BEL, DEL) from any text bound for
// the terminal. stdin fields like session_name, model.display_name, and
// effort.level are echoed into the status line verbatim; without this, escape
// sequences smuggled into them would be interpreted by the terminal (title/OSC
// rewrites, clipboard writes, cursor moves that spoof or hide output). The bar
// is purely visual, so dropping control bytes is lossless. The tool's own ANSI
// color codes are added AFTER sanitizing, so they survive.
// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control bytes is the intent
const sanitize = (text) => String(text).replace(/[\x00-\x1f\x7f-\x9f]/g, '');

export function paint(text, color) {
  const clean = sanitize(text);
  return color && ANSI[color] ? `${ANSI[color]}${clean}\x1b[0m` : clean;
}

// 3-arg form: band(value, amber, red) — used by ttl / rate limits.
// 4-arg form: band(value, amber, orange, red) — used by ctx.
// Orange is skipped when it falls at or below amber.
export function band(value, amber, orangeOrRed, red) {
  if (red === undefined) { red = orangeOrRed; orangeOrRed = undefined; }
  if (value >= red) return 'red';
  if (orangeOrRed !== undefined && orangeOrRed > amber && value >= orangeOrRed) return 'orange';
  if (value >= amber) return 'amber';
  return 'green';
}

// Normalize a resets_at value to epoch ms. Claude Code sends a Unix timestamp
// in seconds; also tolerate ms and ISO.
function toEpochMs(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v < 1e11 ? v * 1000 : v;
  if (typeof v === 'string') {
    if (/^\d+$/.test(v)) return toEpochMs(Number(v));
    const t = Date.parse(v);
    return Number.isNaN(t) ? NaN : t;
  }
  return NaN;
}

// Display-only percentage flip (PRDv2 §3).
export const flipPct = (consumedShown, cfg) => (
  cfg.percentage === 'remaining' ? 100 - consumedShown : consumedShown
);

// True during Anthropic's faster-drain "peak" window (PRDv2 §2): a weekday
// (Mon–Fri) within [start, end) Pacific-time hours.
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
