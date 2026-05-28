import { ROW1_ZONES } from './defaults.js';
import { renderSegments } from './segments.js';
import { resolveTtl } from './ttl.js';
import { paint } from './utils.js';

// Assemble enabled+visible segments into up to three rows.
export function render(data, cfg, env, now, prevSessionState = null) {
  const ttlMin = resolveTtl({ rateLimits: data?.rate_limits, config: cfg, env });
  // CC_CREAM_TZ is an internal test/diagnostic seam, not a documented config key.
  const tz = env?.CC_CREAM_TZ || 'America/Los_Angeles';
  const segs = renderSegments(data, cfg, ttlMin, now, prevSessionState, tz);

  const visible = (id, row) => cfg.segments[id]?.on && segs[id] && cfg.segments[id].row === row;
  const byOrder = (a, b) => cfg.segments[a].order - cfg.segments[b].order;
  const draw = (id) => paint(segs[id].text, segs[id].color);

  const row1 = ROW1_ZONES.map((zone) => zone.filter((id) => visible(id, 1)).sort(byOrder).map(draw).join(' | '))
    .filter((z) => z.length > 0)
    .join(' | ');

  const row2 = Object.keys(cfg.segments)
    .filter((id) => visible(id, 2))
    .sort(byOrder)
    .map(draw)
    .join(' | ');

  const row3 = Object.keys(cfg.segments)
    .filter((id) => visible(id, 3))
    .sort(byOrder)
    .map(draw)
    .join(' | ');

  return [row1, row2, row3].filter((r) => r.length > 0).join('\n');
}
