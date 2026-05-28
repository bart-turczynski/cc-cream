import { numOr } from './utils.js';

const envOn = (v) => typeof v === 'string' && v !== '' && v !== '0' && v.toLowerCase() !== 'false';

export function hasWindow(rl) {
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
