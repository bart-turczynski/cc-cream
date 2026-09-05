// Where cc-cream lives inside Claude Code's plugin host, DISCOVERED rather than
// spelled out. The host lays the cache out as
// `<config>/plugins/cache/<marketplace>/<plugin>/<version>/` and the per-plugin
// data dir as `<config>/plugins/data/<plugin>-<marketplace>/`, so every path
// carries a marketplace segment — and the marketplace name is not ours to pin.
// It changed once already (`cc-cream` → `bart-turczynski`), which silently
// falsified the uninstall escape hatch and the footprint report: both went on
// naming a directory that no longer existed (CREAM-axtbxevj). Deriving the
// segment from what is actually on disk removes the whole drift class, so a
// future rename cannot make our own removal instructions wrong again.
//
// The plugin name is ours and does not drift; only the marketplace does.

import fs from 'node:fs';
import path from 'node:path';

const PLUGIN_NAME = 'cc-cream';

function realpathOr(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
  } catch {
    return [];
  }
}

// If `selfPath` lives under `<root>/plugins/cache/<marketplace>/<plugin>/...`,
// return { pluginsDir, marketplace, pluginHome }; otherwise null (manual/dev
// install — never a cache copy). Every path derives from the running location so
// the host we consult is the one governing THIS install, with no os.homedir()
// assumption.
export function pluginCacheLocation(selfPath) {
  const segs = realpathOr(selfPath).split(path.sep);
  for (let i = 0; i + 3 < segs.length; i++) {
    if (segs[i] === 'plugins' && segs[i + 1] === 'cache') {
      return {
        pluginsDir: segs.slice(0, i + 1).join(path.sep),
        marketplace: segs[i + 2],
        pluginHome: segs.slice(0, i + 4).join(path.sep),
      };
    }
  }
  return null;
}

// Every marketplace under which cc-cream is present in `pluginsDir`, unioned
// from three independent sources so no single stale one hides an install:
//   1. the cache tree itself (`cache/*/cc-cream`) — survives deregistration, so
//      it still finds the orphaned cache `/plugin uninstall` leaves behind;
//   2. the host registry (`installed_plugins.json` keys `cc-cream@<mkt>`) —
//      authoritative while installed, and covers a cache laid out elsewhere;
//   3. `selfPath`, when we are running from the cache ourselves.
// Returns sorted `{ marketplace, home, versions }`, `home` being the plugin dir
// that holds the version subdirectories. Never throws: a missing or unreadable
// host directory just yields fewer entries.
export function findPluginInstalls(pluginsDir, selfPath = null) {
  const cacheDir = path.join(pluginsDir, 'cache');
  const marketplaces = new Set(
    listDirs(cacheDir).filter((mkt) => listDirs(path.join(cacheDir, mkt)).includes(PLUGIN_NAME)),
  );

  let registry;
  try {
    registry = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'installed_plugins.json'), 'utf8'));
  } catch {
    registry = null;
  }
  const entries = registry && typeof registry.plugins === 'object' ? registry.plugins : null;
  for (const key of Object.keys(entries || {})) {
    const [name, mkt] = key.split('@');
    if (name === PLUGIN_NAME && mkt) marketplaces.add(mkt);
  }

  const self = selfPath ? pluginCacheLocation(selfPath) : null;
  if (self && self.pluginsDir === pluginsDir) marketplaces.add(self.marketplace);

  return [...marketplaces].sort().map((marketplace) => {
    const home = path.join(cacheDir, marketplace, PLUGIN_NAME);
    return { marketplace, home, versions: listDirs(home) };
  });
}

// The per-plugin data dirs the host may have created, found by prefix rather
// than by composing `<plugin>-<marketplace>` — so a dir left over from an older
// marketplace still shows up in the footprint report.
export function findPluginDataDirs(pluginsDir) {
  const dataDir = path.join(pluginsDir, 'data');
  return listDirs(dataDir)
    .filter((name) => name === PLUGIN_NAME || name.startsWith(`${PLUGIN_NAME}-`))
    .map((name) => path.join(dataDir, name));
}
