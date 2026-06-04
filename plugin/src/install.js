#!/usr/bin/env node
// cc-cream consent-based installer (PRD §7, §14.1). It copies the runtime
// modules into ~/.claude/cc-cream and writes one `statusLine` block into the
// user's settings.json after showing the change. It detects and confirms before
// replacing an existing line, preserves any user `padding`, and surfaces the
// trust/restart requirement.
//
// The pure `plan()` function does all the decision-making (no I/O) so it is
// testable; the CLI wrapper at the bottom handles reading/prompting/writing.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { checkConfig } from './config.js';
import { isSafeToWrite, readSettings as readSettingsFile, writeFileAtomic } from './settings.js';
import { isEntrypoint } from './utils.js';

export { writeFileAtomic } from './settings.js';

// Absolute path of THIS install.js. When the /cc-cream:uninstall slash command
// runs it, that's the versioned plugin-cache copy — the durable, npm-free
// escape hatch we advertise in the uninstall receipt (resolved, not guessed, so
// it carries the real version and no markdown-stripped placeholder).
const SELF_PATH = fileURLToPath(import.meta.url);

const TRUST_NOTE =
  'The bar appears on your next message — restart only an already-open session, and the workspace must be trusted.';

// The statusLine command: a missing-file guard, then exec node on an ABSOLUTE
// entrypoint. Both install modes use this one shape — only the entrypoint path
// differs (plugin cache vs the copied home runtime).
//
// `nodePath` is the ABSOLUTE node binary, resolved once at setup time — the
// statusLine subprocess may not inherit the user's PATH, so a bare `node` is
// unsafe. `entrypoint` is the absolute path to cc-cream.js.
//
// Why no version resolution here: `${CLAUDE_PLUGIN_ROOT}` does NOT expand in the
// statusLine command context (only in hook/MCP/command contexts — verified), so
// the command can't discover the current plugin version at render time. Instead
// the SessionStart hook — which DOES get `${CLAUDE_PLUGIN_ROOT}` — bakes the
// current version's absolute path here and re-pins it after `/plugin update`.
//
// The `[ -f "<entrypoint>" ] || exit 0` guard degrades to a silent exit 0 when
// the entrypoint is gone — the state left behind if a user runs `/plugin
// uninstall cc-cream` WITHOUT first running `/cc-cream:uninstall`, so a stale
// statusLine outlives the deleted cache. Without it, node would crash with
// MODULE_NOT_FOUND on every render. "Degrade, never crash" (CLAUDE.md). `exec`
// replaces the shell so stdin/stdout pass straight through to the renderer.
export function statusLineCommand(nodePath, entrypoint) {
  return `[ -f "${entrypoint}" ] || exit 0; exec "${nodePath}" "${entrypoint}"`;
}

// `desired` is considered already installed if it matches the planned command
// verbatim (so a changed version path or node path re-plans), at refreshInterval 60.
function isInstalled(existing, command) {
  return (
    !!existing &&
    typeof existing === 'object' &&
    existing.type === 'command' &&
    typeof existing.command === 'string' &&
    existing.command === command &&
    existing.refreshInterval === 60
  );
}

// True if an existing statusLine belongs to cc-cream under ANY install strategy
// (dev repo, copied home runtime, or the plugin cache-glob) — every command
// references the cc-cream entrypoint. Used by uninstall so we never touch a
// statusLine the user wired for something else.
export function isCcCreamStatusLine(existing) {
  return (
    !!existing &&
    typeof existing === 'object' &&
    existing.type === 'command' &&
    typeof existing.command === 'string' &&
    existing.command.includes('cc-cream')
  );
}

// Decide what an uninstall should do. Pure: returns { settings, changed, messages }.
// Removes ONLY a cc-cream statusLine; a foreign statusLine is left verbatim.
export function planUninstall(settings) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const existing = s.statusLine;
  const messages = [];

  if (!isCcCreamStatusLine(existing)) {
    if (existing && typeof existing === 'object') {
      messages.push("Your statusLine is not cc-cream's — leaving it untouched.");
    } else {
      messages.push('No cc-cream statusLine found in settings.json — nothing to remove.');
    }
    return { settings: s, changed: false, messages };
  }

  messages.push("Removed cc-cream's statusLine.");
  const next = { ...s };
  delete next.statusLine;
  return { settings: next, changed: true, messages };
}

// Decide what to do. Returns { settings, changed, messages, needsConsent }.
// `consent` is the user's yes/no when a FOREIGN statusLine must be replaced.
//
// Both install modes produce the same command shape (statusLineCommand); only
// the entrypoint differs:
//   - manual (default): the copied-to-home runtime (~/.claude/cc-cream/cc-cream.js).
//   - plugin: the versioned plugin-cache entrypoint (install.js's sibling).
// Pass `{ entrypoint, nodePath }` for either.
export function plan(settings, { entrypoint, consent, nodePath } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const existing = s.statusLine;
  const messages = [];

  const command = statusLineCommand(nodePath, entrypoint);
  const desired = { type: 'command', command, refreshInterval: 60 };
  // Preserve any user padding — it shrinks the 80-col budget (PRD §7).
  if (existing && typeof existing === 'object' && existing.padding !== undefined) {
    desired.padding = existing.padding;
  }

  if (isInstalled(existing, command)) {
    messages.push('cc-cream is already installed — no changes needed.');
    return { settings: s, changed: false, messages, needsConsent: false };
  }

  // A FOREIGN statusLine must be confirmed before replacing. Replacing our OWN
  // out-of-date line (e.g. re-pinning to a new version after /plugin update)
  // needs no consent — it's ours to maintain.
  const hasForeign = existing && typeof existing === 'object' && !isCcCreamStatusLine(existing);
  if (hasForeign) {
    messages.push('An existing statusLine is configured.');
    messages.push('Replace it with cc-cream?');
    if (consent !== true) {
      messages.push('Declined — your existing statusLine is unchanged.');
      return { settings: s, changed: false, messages, needsConsent: true };
    }
  }

  messages.push('Setting the cc-cream statusLine.');
  messages.push(TRUST_NOTE);
  return { settings: { ...s, statusLine: desired }, changed: true, messages, needsConsent: hasForeign };
}

// ---------------------------------------------------------------------------
// CLI wrapper.
// ---------------------------------------------------------------------------
function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function destinationPath() {
  return path.join(os.homedir(), '.claude', 'cc-cream', 'cc-cream.js');
}

// Read settings.json safely for the CLI. A MISSING or empty file -> {} (fresh
// start, nothing to lose); a valid object is returned as-is. Any other state
// (corrupt JSON, a non-object, or an unreadable file) is REFUSED: we exit rather
// than overwrite and erase the user's other settings (permissions, hooks,
// plugins...). This guards the one path where a blind write would be destructive.
function readSettings(file) {
  const { state, value } = readSettingsFile(file);
  if (isSafeToWrite(state)) return value;
  if (state === 'corrupt') {
    console.error(`Error: ${file} is not valid JSON.`);
    console.error('Refusing to write it — that would erase your other settings.');
    console.error('Fix the JSON (or move the file aside) and re-run.');
  } else if (state === 'nonobject') {
    console.error(`Error: ${file} does not contain a JSON object.`);
    console.error('Refusing to overwrite it. Move it aside and re-run if intended.');
  } else {
    console.error(`Error: cannot read ${file}.`);
    console.error('Refusing to overwrite it. Fix permissions (or move it aside) and re-run.');
  }
  process.exit(1);
}

function runtimeFiles(sourceFile) {
  const sourceDir = path.dirname(sourceFile);
  return fs.readdirSync(sourceDir)
    .filter((name) => name.endsWith('.js') && name !== 'install.js')
    .map((name) => path.join(sourceDir, name));
}

function copyRuntimeFiles(sourceFile, destDir) {
  let copied = false;
  fs.mkdirSync(destDir, { recursive: true });
  for (const file of runtimeFiles(sourceFile)) {
    const dest = path.join(destDir, path.basename(file));
    const needsCopy = !fs.existsSync(dest) || fs.statSync(file).mtime > fs.statSync(dest).mtime;
    if (needsCopy) {
      fs.copyFileSync(file, dest);
      copied = true;
    }
  }
  return copied;
}

// Resolve the absolute node binary to bake into the statusLine command. The
// status line runs as a detached subprocess that may not inherit the user's
// PATH, so a bare `node` is unsafe. We prefer the shell's `command -v node`
// (the path the user's interactive shell would pick), falling back to
// process.execPath (the node currently running setup) if that fails.
export function resolveNodePath() {
  try {
    const found = execSync('command -v node', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch {
    // fall through
  }
  return process.execPath;
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question} [y/N] `, (a) => {
    rl.close();
    resolve(/^y(es)?$/i.test(a.trim()));
  }));
}

// Remove the cc-cream wiring and its throwaway scratch. The copied runtime
// (~/.claude/cc-cream) and session state (~/.claude/cc-cream-state.json) are
// regenerable — reinstalling recreates them — so they're always cleaned, no
// prompt. (The old interactive artifact prompt was dead code: both the `!` bang
// runner and the slash commands run non-TTY — CREAM-lznfgrap.) `--purge`
// additionally removes the one file worth keeping by default: the user-authored
// config (~/.claude/cc-cream.json).
async function uninstall({ purge }) {
  const file = settingsPath();
  const settings = readSettings(file);
  const result = planUninstall(settings);
  for (const m of result.messages) console.log(m);
  if (result.changed) {
    writeFileAtomic(file, `${JSON.stringify(result.settings, null, 2)}\n`);
    console.log(`Updated ${file}.`);
  }

  const home = path.join(os.homedir(), '.claude');
  const configFile = path.join(home, 'cc-cream.json');

  // Auto-clean regenerable scratch (not user data — no prompt).
  const scratch = [path.join(home, 'cc-cream'), path.join(home, 'cc-cream-state.json')]
    .filter((p) => fs.existsSync(p));
  for (const p of scratch) fs.rmSync(p, { recursive: true, force: true });
  if (scratch.length) console.log('Removed the copied runtime and session state.');

  if (fs.existsSync(configFile)) {
    if (purge) {
      fs.rmSync(configFile, { force: true });
      console.log(`Removed your config ${configFile}.`);
    } else {
      console.log(`Kept your config ${configFile} (pass --purge to remove it too).`);
    }
  }

  printUninstallReceipt();
}

// Shorten an absolute path under $HOME to a `~/…` form for display. The shell
// still expands `~`, so the result stays copy-pasteable.
function tildeify(p) {
  const home = os.homedir();
  return p === home || p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

// The closing receipt. No Claude Code host removal path drops our statusLine OR
// the version cache, so spell out what's gone, what the host leaves behind, and
// the npm-free escape hatch (the lingering cache always has a working install.js).
// See project memory cc-cream-plugin-lifecycle-findings.
//
// The escape-hatch line prints SELF_PATH — this install.js's real, resolved
// location — NOT a `<version>` placeholder. The receipt reaches the user through
// the slash command, whose output Claude Code renders as markdown; `<version>`
// was silently stripped to an empty segment (cc-cream//src), breaking copy-paste
// exactly when it's needed (CREAM-rhtrzwss). Via the slash command SELF_PATH IS
// the versioned cache copy, so the path is both accurate and markdown-safe.
function printUninstallReceipt() {
  console.log('\nDone — the bar disappears on your next message (restart an already-open session to drop it now).');
  console.log('The host leaves the rest behind; to fully remove cc-cream:');
  console.log('  • Plugin: /plugin uninstall cc-cream  then  /plugin marketplace remove cc-cream');
  console.log('  • Version cache (never auto-removed): rm -rf ~/.claude/plugins/cache/cc-cream');
  console.log('  • The /cc-cream:* slash commands linger in this session until you restart Claude Code.');
  console.log('Re-run this uninstall later (e.g. the plugin is gone but the bar lingers) — it lives at:');
  console.log(`  node ${tildeify(SELF_PATH)} --uninstall [--purge]`);
}

// `cc-cream-setup --check-config`: lint ~/.claude/cc-cream.json against the
// config schema, reporting unknown keys and out-of-domain values (which the
// renderer silently ignores). Exits non-zero when problems are found.
function checkConfigCli() {
  const file = path.join(os.homedir(), '.claude', 'cc-cream.json');
  if (!fs.existsSync(file)) {
    console.log(`No config at ${file} — cc-cream uses its defaults. Nothing to check.`);
    return;
  }
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trim() === '') {
    console.log(`${file} is empty — cc-cream uses its defaults. Nothing to check.`);
    return;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Error: ${file} is not valid JSON — the whole file is ignored.`);
    process.exit(1);
  }
  const problems = checkConfig(parsed);
  if (problems.length === 0) {
    console.log(`${file}: OK — config looks good.`);
    return;
  }
  console.error(`${file}: ${problems.length} problem(s) — each falls back to the default:`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
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

function readJsonSafe(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

// `cc-cream-setup --status`: a read-only report of cc-cream's entire on-disk
// footprint. Because no Claude Code host removal path drops our statusLine or GCs
// the version cache (project memory cc-cream-plugin-lifecycle-findings), users
// can't otherwise tell whether cc-cream fully went away — this command answers
// "clean slate?" in one shot, and points out what the host left behind.
function statusCli() {
  const home = path.join(os.homedir(), '.claude');
  const plugins = path.join(home, 'plugins');
  const items = [];
  const add = (label, present, detail) => items.push({ label, present, detail });

  // statusLine wiring
  const { state, value } = readSettingsFile(settingsPath());
  if (!isSafeToWrite(state)) {
    add('statusLine wiring', false, `settings.json unreadable (${state}) — not inspected`);
  } else if (isCcCreamStatusLine(value.statusLine)) {
    const ep = (value.statusLine.command.match(/\[ -f "([^"]+)"/) || [])[1] || '';
    const ok = ep && fs.existsSync(ep);
    add('statusLine wiring', true, ok
      ? `belongs to cc-cream, pinned to ${ep}`
      : `belongs to cc-cream, pinned to ${ep || '(unknown)'} — entrypoint MISSING (stale/ghost wiring)`);
  } else if (value.statusLine) {
    add('statusLine wiring', false, 'present but not cc-cream’s (left untouched)');
  } else {
    add('statusLine wiring', false, 'none');
  }

  // plugin cache versions (the host never GCs these)
  const versions = listDirs(path.join(plugins, 'cache', 'cc-cream', 'cc-cream'));
  add('plugin cache', versions.length > 0, versions.length
    ? `${versions.length} version(s) [${versions.join(', ')}] — host never GCs these; rm to reclaim`
    : 'none');

  // marketplace clone
  const clone = path.join(plugins, 'marketplaces', 'cc-cream');
  add('marketplace clone', fs.existsSync(clone), fs.existsSync(clone) ? clone : 'none');

  // registrations
  const installed = readJsonSafe(path.join(plugins, 'installed_plugins.json'));
  const isRegistered = !!installed?.plugins && typeof installed.plugins === 'object'
    && Object.keys(installed.plugins).some((k) => k.startsWith('cc-cream@'));
  add('plugin registration', isRegistered, isRegistered
    ? 'listed in installed_plugins.json'
    : 'not listed in installed_plugins.json');

  const known = readJsonSafe(path.join(plugins, 'known_marketplaces.json'));
  const knownMkt = !!known && typeof known === 'object' && Object.hasOwn(known, 'cc-cream');
  add('marketplace registration', knownMkt, knownMkt
    ? 'listed in known_marketplaces.json'
    : 'not listed in known_marketplaces.json');

  // auto-wire marker (plugin data dir, falling back to the config dir)
  const markerDir = process.env.CLAUDE_PLUGIN_DATA || path.join(plugins, 'data', 'cc-cream-cc-cream');
  const marker = [path.join(markerDir, 'cc-cream-autowire-done'), path.join(home, 'cc-cream-autowire-done')]
    .find((p) => fs.existsSync(p));
  add('auto-wire marker', !!marker, marker || 'none');

  // session state
  const stateFile = path.join(home, 'cc-cream-state.json');
  if (fs.existsSync(stateFile)) {
    const obj = readJsonSafe(stateFile);
    const n = obj && typeof obj === 'object' ? Object.keys(obj).length : '?';
    add('session state', true, `${n} session(s) in cc-cream-state.json`);
  } else {
    add('session state', false, 'none');
  }

  // config
  const configFile = path.join(home, 'cc-cream.json');
  add('config', fs.existsSync(configFile), fs.existsSync(configFile) ? configFile : 'none (using defaults)');

  // manual runtime copy
  const runtimeDir = path.join(home, 'cc-cream');
  add('manual runtime copy', fs.existsSync(runtimeDir), fs.existsSync(runtimeDir) ? runtimeDir : 'none');

  console.log('cc-cream footprint:');
  for (const it of items) console.log(`  [${it.present ? 'x' : ' '}] ${it.label}: ${it.detail}`);

  if (items.every((i) => !i.present)) {
    console.log('\nClean slate — no cc-cream footprint found.');
    return;
  }
  console.log(`\n${items.filter((i) => i.present).length} component(s) present. To remove everything:`);
  console.log('  /cc-cream:uninstall (or the cache-path install.js --uninstall) clears the statusLine + scratch;');
  console.log('  then /plugin uninstall cc-cream + /plugin marketplace remove cc-cream;');
  console.log('  then rm -rf ~/.claude/plugins/cache/cc-cream (the host never removes it).');
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    statusCli();
    return;
  }
  if (args.includes('--check-config')) {
    checkConfigCli();
    return;
  }
  if (args.includes('--uninstall')) {
    await uninstall({ purge: args.includes('--purge') });
    return;
  }
  const plugin = args.includes('--plugin');
  const force = args.includes('--force') || args.includes('--yes');
  // First non-flag arg is an optional local source path (manual mode only).
  const positional = args.filter((a) => !a.startsWith('--'));

  const file = settingsPath();
  const settings = readSettings(file);

  // planOpts holds the entrypoint + node path the command bakes in.
  let planOpts;
  if (plugin) {
    // Plugin mode: the plugin cache IS the install — do NOT copy to home. Point
    // the statusLine at this install.js's sibling cc-cream.js, i.e. the current
    // version's absolute path in the plugin cache. The SessionStart hook re-pins
    // it after a /plugin update (the command can't self-resolve the version).
    const entrypoint = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cc-cream.js');
    planOpts = { entrypoint, nodePath: resolveNodePath() };
  } else {
    // Manual / GitHub mode: copy the runtime into ~/.claude/cc-cream and point
    // the statusLine at that copied (stable) entrypoint.
    const sourceFile = positional[0]
      ? path.resolve(positional[0])
      : path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'cc-cream.js');

    if (!fs.existsSync(sourceFile)) {
      console.error(`Error: cc-cream.js not found at ${sourceFile}`);
      process.exit(1);
    }

    const dest = destinationPath();
    const destDir = path.dirname(dest);
    if (copyRuntimeFiles(sourceFile, destDir)) {
      console.log(`Copied cc-cream runtime files to ${destDir}`);
    }
    planOpts = { entrypoint: dest, nodePath: resolveNodePath() };
  }

  let result = plan(settings, planOpts);
  // A foreign statusLine needs consent before we replace it. This first plan()
  // pass is detection only — do NOT print its messages: they include a
  // speculative "Declined …" (consent was absent) that would contradict a
  // subsequent --force replace. Resolve consent, re-plan, then print the single
  // coherent second-pass result below (CREAM-hpjebzes).
  if (!result.changed && result.needsConsent) {
    let yes;
    if (process.stdin.isTTY) {
      yes = await ask('Replace your existing statusLine with cc-cream?');
    } else {
      // Non-interactive (e.g. run via the /cc-cream:setup slash command, which has
      // no TTY): never block on a prompt. Safe to overwrite our OWN wiring (an
      // older/other-strategy cc-cream statusLine); never clobber a FOREIGN
      // statusLine without a terminal or an explicit --force.
      yes = force || isCcCreamStatusLine(settings.statusLine);
      console.log(yes
        ? 'Non-interactive: replacing the existing statusLine with cc-cream’s.'
        : 'Non-interactive: left your existing statusLine unchanged. Re-run in a terminal, or pass --force, to replace it.');
    }
    result = plan(settings, { ...planOpts, consent: yes });
  }

  for (const m of result.messages) console.log(m);
  if (result.changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    writeFileAtomic(file, `${JSON.stringify(result.settings, null, 2)}\n`);
    console.log(`\nWrote ${file}.`);
  }
}

// isEntrypoint (src/utils.js) is symlink-robust: a plain href comparison fails when
// install.js runs from a symlinked path (e.g. a dotfile-managed ~/.claude), which
// would make `cc-cream-setup` / the slash commands silently do nothing.
if (isEntrypoint(import.meta.url)) {
  main();
}
