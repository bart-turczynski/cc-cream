// Helpers for the install/uninstall JOURNEY smoke tests (features/27-*).
//
// Unlike the unit specs, these drive the REAL artifacts end to end: they stage a
// plugin cache the way `/plugin install` lays it out, run the actual SessionStart
// hook and install.js as child processes, and execute the baked statusLine command
// through `sh -c` exactly as Claude Code does. Everything is keyed off a sandbox
// HOME so the hook (CLAUDE_CONFIG_DIR-aware), install.js (os.homedir()-based), and
// the baked command (`$HOME/.claude`) all resolve to the same config dir. We leave
// CLAUDE_CONFIG_DIR unset on purpose so those three agree on `$HOME/.claude`.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from './world.js';

const MARKETPLACE = 'cc-cream';
const PLUGIN = 'cc-cream';

export const configDirOf = (home) => path.join(home, '.claude');
export const cacheRoot = (home) => path.join(configDirOf(home), 'plugins', 'cache', MARKETPLACE, PLUGIN);

// A small but fully renderable session payload; the model name lets tests assert
// the bar actually came out.
export const SESSION_JSON = JSON.stringify({
  session_id: 'journey-smoke',
  model: { display_name: 'Sonnet 4.6' },
  context_window: { used_percentage: 12, total_input_tokens: 24000 },
  cost: { total_cost_usd: 0.5 },
});
export const MODEL_NAME = 'Sonnet 4.6';

function baseEnv(home) {
  const env = { ...process.env, HOME: home };
  // Force the $HOME/.claude default path across hook + install.js + baked command.
  delete env.CLAUDE_CONFIG_DIR;
  return env;
}

// Copy the plugin's runtime tree into <config>/plugins/cache/<mkt>/<plugin>/<version>/,
// mirroring how `/plugin install` clones it: only the plugin/ source subdirectory
// is copied (its src/, hooks/, .claude-plugin/), so the cache root equals
// CLAUDE_PLUGIN_ROOT. package.json stays out of this tree by construction.
export function stageCache(home, version) {
  const root = path.join(cacheRoot(home), version);
  for (const dir of ['src', 'hooks', '.claude-plugin']) {
    fs.cpSync(path.join(REPO, 'plugin', dir), path.join(root, dir), { recursive: true });
  }
  registerPlugin(home, version, root);
  return root;
}

const registryPath = (home) => path.join(configDirOf(home), 'plugins', 'installed_plugins.json');

// Write the installed_plugins.json entry that `/plugin install` creates, so the
// renderer's ghost-bar self-defense (which consults this registry to tell a live
// install from an orphaned cache) sees cc-cream as installed. Keyed
// `<plugin>@<marketplace>`, installPath = the version dir.
function registerPlugin(home, version, installPath) {
  const reg = registryPath(home);
  let parsed = { version: 2, plugins: {} };
  if (fs.existsSync(reg)) {
    try {
      parsed = JSON.parse(fs.readFileSync(reg, 'utf8'));
    } catch {
      parsed = { version: 2, plugins: {} };
    }
  }
  if (!parsed.plugins || typeof parsed.plugins !== 'object') parsed.plugins = {};
  parsed.plugins[`${PLUGIN}@${MARKETPLACE}`] = [{ scope: 'user', installPath, version }];
  fs.mkdirSync(path.dirname(reg), { recursive: true });
  fs.writeFileSync(reg, `${JSON.stringify(parsed, null, 2)}\n`);
}

// Simulate the REAL `/plugin uninstall cc-cream`: it removes the registry entry
// (+ enabledPlugins + the data dir) but LEAVES the cache tree AND our statusLine
// (verified 2026-05-30, probes B/E/F). This is the ghost-bar trap the `[ -f ]`
// guard can't catch — the entrypoint still exists — which the renderer's registry
// check (CREAM-uchemxln) is there to defuse.
export function deregisterPlugin(home) {
  const reg = registryPath(home);
  if (!fs.existsSync(reg)) return;
  const parsed = JSON.parse(fs.readFileSync(reg, 'utf8'));
  if (parsed?.plugins && typeof parsed.plugins === 'object') {
    for (const key of Object.keys(parsed.plugins)) {
      if (key.startsWith(`${PLUGIN}@`)) delete parsed.plugins[key];
    }
  }
  fs.writeFileSync(reg, `${JSON.stringify(parsed, null, 2)}\n`);
}

// Run the real SessionStart auto-setup hook from a staged cache.
export function runAutoSetupHook(home, pluginRoot, pluginData) {
  const env = { ...baseEnv(home), CLAUDE_PLUGIN_ROOT: pluginRoot, CLAUDE_PLUGIN_DATA: pluginData };
  const res = spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'auto-setup.js')], {
    env,
    input: '',
    encoding: 'utf8',
  });
  let systemMessage = null;
  try {
    systemMessage = JSON.parse(res.stdout || '{}').systemMessage ?? null;
  } catch {
    /* no JSON emitted (silent path) */
  }
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '', systemMessage };
}

// Run install.js with args, as the cc-cream-setup bin / slash command would
// (non-interactive: piped stdin, no TTY). `installJs` lets the recovery scenario
// run the checked-out copy after the plugin cache is gone.
export function runInstall(home, args, { installJs } = {}) {
  const entry = installJs || path.join(REPO, 'plugin', 'src', 'install.js');
  const res = spawnSync(process.execPath, [entry, ...args], {
    env: baseEnv(home),
    input: '',
    encoding: 'utf8',
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Execute the baked statusLine command exactly as Claude Code does: `sh -c`, with
// the session JSON on stdin.
export function runStatusLine(home, command, input = SESSION_JSON) {
  const res = spawnSync('sh', ['-c', command], { env: baseEnv(home), input, encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// Extract the absolute entrypoint baked into a statusLine command — the path in
// the `[ -f "<path>" ]` guard — to assert which cached version it points at.
export function bakedEntrypoint(command) {
  const m = command.match(/\[ -f "([^"]+)"/);
  return m ? m[1] : '';
}

export function readSettings(home) {
  const p = path.join(configDirOf(home), 'settings.json');
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeSettings(home, settings) {
  const p = path.join(configDirOf(home), 'settings.json');
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(settings, null, 2)}\n`);
}

// Simulate `/plugin uninstall cc-cream`: Claude Code deletes the plugin cache.
export function removePluginCache(home) {
  fs.rmSync(path.join(configDirOf(home), 'plugins'), { recursive: true, force: true });
}

// Simulate cache pruning of a single cached version (e.g. `/plugin update` cleaning
// up an old dir, or the newest being removed).
export function removeVersion(home, version) {
  fs.rmSync(path.join(cacheRoot(home), version), { recursive: true, force: true });
}
