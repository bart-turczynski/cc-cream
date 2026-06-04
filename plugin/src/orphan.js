import fs from 'node:fs';
import path from 'node:path';

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

// If `selfPath` lives under `<root>/plugins/cache/<marketplace>/<plugin>/...`,
// return { pluginsDir, pluginHome }; otherwise null (manual/dev install, never
// a cache orphan). Both paths derive from the running location so the registry
// we consult is the one governing THIS install — no os.homedir() assumption.
function pluginCacheLocation(selfPath) {
  const segs = realpathOr(selfPath).split(path.sep);
  for (let i = 0; i + 3 < segs.length; i++) {
    if (segs[i] === 'plugins' && segs[i + 1] === 'cache') {
      return {
        pluginsDir: segs.slice(0, i + 1).join(path.sep),
        pluginHome: segs.slice(0, i + 4).join(path.sep),
      };
    }
  }
  return null;
}

function isWithin(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

// True when this renderer is a plugin-cache orphan: running from the cache while
// cc-cream is absent from the host's installed_plugins.json. Cost is one tiny
// read, and ONLY on the plugin-cache path — manual/dev installs return early
// before touching the disk. A missing registry (ENOENT) counts as orphaned; any
// other read/parse failure is treated as not-orphaned, so a transient glitch can
// never suppress a legitimately wired bar.
export function isOrphanedPluginRun(selfPath) {
  const loc = pluginCacheLocation(selfPath);
  if (!loc) return false;
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(path.join(loc.pluginsDir, 'installed_plugins.json'), 'utf8'));
  } catch (err) {
    return err?.code === 'ENOENT';
  }
  const plugins = parsed && typeof parsed === 'object' ? parsed.plugins : null;
  if (!plugins || typeof plugins !== 'object') return true;
  const home = realpathOr(loc.pluginHome);
  for (const entries of Object.values(plugins)) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (entry && typeof entry.installPath === 'string' && isWithin(home, realpathOr(entry.installPath))) {
        return false;
      }
    }
  }
  return true;
}
