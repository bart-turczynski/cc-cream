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
import { isEntrypoint } from './utils.js';

const TRUST_NOTE =
  'Claude Code must be trusted and possibly restarted for the status line to appear.';

// The cache-glob auto-update command (docs/RELEASE_PLAN.md "Auto-update mechanism").
// `nodePath` is the ABSOLUTE node binary, resolved once at setup time — the
// statusLine subprocess may not inherit the user's PATH, so a bare `node` is
// unsafe. The `-d .../*/` glob yields directory paths with a trailing slash, so
// `src/cc-cream.js` concatenates directly. The `grep` keeps ONLY semver-named
// dirs (e.g. `0.1.10/`) before `sort -V | tail -1` picks the highest — without
// it, a non-numeric cache dir (a git-sha install like `c83650b6360f/`) sorts
// last and pins the bar to whatever version that happens to be, defeating
// auto-update. With it, `/plugin update` is applied live with no re-run of setup.
//
// The resolved dir is captured in `$d` and GUARDED with `[ -z "$d" ] && exit 0`:
// when the glob matches nothing — the state left behind if a user runs
// `/plugin uninstall cc-cream` WITHOUT first running `/cc-cream:uninstall`, so a
// stale statusLine outlives the deleted cache — the command degrades to a silent
// exit 0 instead of running a bare relative `src/cc-cream.js` that crashes with
// MODULE_NOT_FOUND on every render. "Degrade, never crash" (CLAUDE.md). `exec`
// replaces the shell so stdin/stdout pass straight through to the renderer.
export function autoUpdateCommand(nodePath) {
  return `d="$(ls -1d "\${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/cc-cream/*/ 2>/dev/null | grep -E '/[0-9]+(\\.[0-9]+)+/$' | sort -V | tail -1)"; [ -z "$d" ] && exit 0; exec "${nodePath}" "\${d}src/cc-cream.js"`;
}

// `desired` is considered already installed if it matches the planned command
// verbatim (so switching strategy or node path re-plans), at refreshInterval 60.
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
// `consent` is the user's yes/no when an existing statusLine must be replaced.
//
// Two command strategies:
//   - manual (default): `node <entrypoint>` pointing at the copied-to-home runtime.
//   - plugin: the cache-glob auto-update command, using the absolute `nodePath`.
//     Pass `{ plugin: true, nodePath }` to select it; the plugin cache IS the
//     install, so no files are copied to home in that mode.
export function plan(settings, { entrypoint, consent, plugin = false, nodePath } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const existing = s.statusLine;
  const messages = [];

  const command = plugin
    ? autoUpdateCommand(nodePath)
    : `node ${entrypoint}`;
  const desired = { type: 'command', command, refreshInterval: 60 };
  // Preserve any user padding — it shrinks the 80-col budget (PRD §7).
  if (existing && typeof existing === 'object' && existing.padding !== undefined) {
    desired.padding = existing.padding;
  }

  if (isInstalled(existing, command)) {
    messages.push('cc-cream is already installed — no changes needed.');
    return { settings: s, changed: false, messages, needsConsent: false };
  }

  // An existing (different) statusLine must be confirmed before replacing.
  const hasExisting = existing && typeof existing === 'object';
  if (hasExisting) {
    messages.push('An existing statusLine is configured.');
    messages.push('Replace it with cc-cream?');
    if (consent !== true) {
      messages.push('Declined — your existing statusLine is unchanged.');
      return { settings: s, changed: false, messages, needsConsent: true };
    }
  }

  messages.push('Setting the cc-cream statusLine.');
  messages.push(TRUST_NOTE);
  return { settings: { ...s, statusLine: desired }, changed: true, messages, needsConsent: hasExisting };
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

// Write `contents` to `file` atomically: write a sibling temp file, then rename
// over the target (rename is atomic within a filesystem). settings.json holds
// the user's permissions/hooks/plugins/MCP config — a direct writeFileSync that
// is interrupted (crash, ENOSPC) could truncate it and erase all of that. The
// temp file shares the target's directory so the rename never crosses devices.
export function writeFileAtomic(file, contents) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, contents);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch {}
    throw err;
  }
}

// Read settings.json safely. A MISSING or empty file -> {} (fresh start, nothing
// to lose). A file that exists with content but fails to parse, or parses to a
// non-object, is REFUSED: we exit rather than overwrite and erase the user's
// other settings (permissions, hooks, plugins...). This guards the one path
// where a blind write would be destructive.
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  const raw = fs.readFileSync(file, 'utf8');
  if (raw.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error(`Error: ${file} is not valid JSON.`);
    console.error('Refusing to write it — that would erase your other settings.');
    console.error('Fix the JSON (or move the file aside) and re-run.');
    process.exit(1);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    console.error(`Error: ${file} does not contain a JSON object.`);
    console.error('Refusing to overwrite it. Move it aside and re-run if intended.');
    process.exit(1);
  }
  return parsed;
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

// Remove the cc-cream wiring (and, with consent, its install artifacts). Keeps
// the user's config (~/.claude/cc-cream.json) unless `--purge` is passed.
async function uninstall({ purge }) {
  const file = settingsPath();
  const settings = readSettings(file);
  const result = planUninstall(settings);
  for (const m of result.messages) console.log(m);
  if (result.changed) {
    writeFileAtomic(file, `${JSON.stringify(result.settings, null, 2)}\n`);
    console.log(`\nUpdated ${file}.`);
  }

  const home = path.join(os.homedir(), '.claude');
  const runtimeDir = path.join(home, 'cc-cream');
  const stateFile = path.join(home, 'cc-cream-state.json');
  const configFile = path.join(home, 'cc-cream.json');

  const artifacts = [runtimeDir, stateFile].filter((p) => fs.existsSync(p));
  if (artifacts.length) {
    let remove = purge;
    if (!remove && process.stdin.isTTY) {
      remove = await ask(`Also delete the copied runtime and session state?\n  ${artifacts.join('\n  ')}`);
    }
    if (remove) {
      for (const p of artifacts) fs.rmSync(p, { recursive: true, force: true });
      console.log('Removed runtime and state files.');
    } else if (process.stdin.isTTY) {
      console.log('Left runtime and state files in place.');
    } else {
      // Non-interactive (e.g. run via the /cc-cream:uninstall slash command, which
      // has no TTY): never block on a prompt. The statusLine — the thing that
      // matters — is already removed; keep the artifacts (deletion is destructive)
      // and say how to remove them.
      console.log(`Left runtime and session state in place — no terminal to confirm deletion:\n  ${artifacts.join('\n  ')}`);
      console.log('Re-run in a terminal, or pass --purge, to remove them.');
    }
  }
  if (purge && fs.existsSync(configFile)) {
    fs.rmSync(configFile, { force: true });
    console.log(`Removed config ${configFile}.`);
  } else if (fs.existsSync(configFile)) {
    console.log(`Kept your config ${configFile} (pass --purge to remove it too).`);
  }

  console.log('\nRestart Claude Code to drop the bar.');
}

async function main() {
  const args = process.argv.slice(2);
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

  // planOpts holds whatever the chosen strategy needs to build its command.
  let planOpts;
  if (plugin) {
    // Plugin mode: the plugin cache IS the install — do NOT copy to home. The
    // command self-resolves the latest cached version on every render.
    planOpts = { plugin: true, nodePath: resolveNodePath() };
  } else {
    // Manual / GitHub mode: copy the runtime into ~/.claude/cc-cream and point
    // the statusLine at that copied entrypoint.
    const sourceFile = positional[0]
      ? path.resolve(positional[0])
      : path.resolve(path.dirname(new URL(import.meta.url).pathname), 'cc-cream.js');

    if (!fs.existsSync(sourceFile)) {
      console.error(`Error: cc-cream.js not found at ${sourceFile}`);
      process.exit(1);
    }

    const dest = destinationPath();
    const destDir = path.dirname(dest);
    if (copyRuntimeFiles(sourceFile, destDir)) {
      console.log(`Copied cc-cream runtime files to ${destDir}`);
    }
    planOpts = { entrypoint: dest };
  }

  let result = plan(settings, planOpts);
  // If a replace needs consent, ask now and re-plan with the answer.
  if (!result.changed && result.needsConsent) {
    for (const m of result.messages) console.log(m);
    let yes;
    if (process.stdin.isTTY) {
      yes = await ask('Replace it with cc-cream?');
    } else {
      // Non-interactive (e.g. run via the /cc-cream:setup slash command, which has
      // no TTY): never block on a prompt. Safe to overwrite our OWN wiring (an
      // older/other-strategy cc-cream statusLine); never clobber a FOREIGN
      // statusLine without a terminal or an explicit --force.
      yes = force || isCcCreamStatusLine(settings.statusLine);
      console.log(yes
        ? 'Non-interactive: replacing the existing cc-cream statusLine.'
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
