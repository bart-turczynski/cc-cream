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

const TRUST_NOTE =
  'Claude Code must be trusted and possibly restarted for the status line to appear.';

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

async function main() {
  const args = process.argv.slice(2);
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
