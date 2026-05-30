// Step definitions for the install/uninstall JOURNEY smoke tests (features/27-*).
// These exercise the real artifacts; see features/support/journey.js for the
// child-process helpers. Journey state lives on the World as this.journeyHome
// (the sandbox HOME every command resolves against), this.pluginRoot, etc.

import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO } from '../support/world.js';
import {
  MODEL_NAME,
  bakedEntrypoint,
  configDirOf,
  readSettings,
  removePluginCache,
  removeVersion,
  runAutoSetupHook,
  runInstall,
  runStatusLine,
  stageCache,
  writeSettings,
} from '../support/journey.js';

const statusLineOf = (world) => readSettings(world.journeyHome).statusLine;
const isCcCream = (sl) => !!sl && sl.type === 'command' && typeof sl.command === 'string' && sl.command.includes('cc-cream');

// ---- Given: config dir shapes --------------------------------------------

Given('a fresh Claude config dir', function () {
  // Reuse the sandbox HOME; ensure its .claude exists and is empty of wiring.
  this.journeyHome = this.home;
  fs.mkdirSync(configDirOf(this.journeyHome), { recursive: true });
  this.pluginData = path.join(this.home, 'plugin-data');
});

Given('a Claude config dir reached through a symlink', function () {
  // Mirror a dotfile-managed / synced HOME: the config dir is reached through a
  // symlink, so the engine ultimately runs from a symlinked path (v0.1.16).
  const real = path.join(this.home, 'realhome');
  const link = path.join(this.home, 'linkhome');
  fs.mkdirSync(path.join(real, '.claude'), { recursive: true });
  fs.symlinkSync(real, link);
  this.journeyHome = link;
  this.pluginData = path.join(this.home, 'plugin-data');
});

Given('settings.json already has a foreign statusLine', function () {
  writeSettings(this.journeyHome, {
    statusLine: { type: 'command', command: '/usr/bin/my-own-bar.sh', refreshInterval: 30 },
  });
});

// ---- Given/When: install + wire ------------------------------------------

Given('the cc-cream plugin freshly installed in the cache at version {string}', function (version) {
  this.pluginRoot = stageCache(this.journeyHome, version);
  this.installedVersion = version;
});

Given('the auto-setup hook has wired the bar', function () {
  this.hookResult = runAutoSetupHook(this.journeyHome, this.pluginRoot, this.pluginData);
  assert.equal(this.hookResult.status, 0, `hook exited ${this.hookResult.status}: ${this.hookResult.stderr}`);
  const sl = statusLineOf(this);
  assert.ok(isCcCream(sl), `expected the hook to wire cc-cream's statusLine, got: ${JSON.stringify(sl)}`);
  this.statusLineCmd = sl.command;
});

When('the SessionStart auto-setup hook runs', function () {
  this.hookResult = runAutoSetupHook(this.journeyHome, this.pluginRoot, this.pluginData);
  assert.equal(this.hookResult.status, 0, `hook exited ${this.hookResult.status}: ${this.hookResult.stderr}`);
});

When('a newer version {string} appears in the plugin cache', function (version) {
  // Claude Code activates the newest install and sets CLAUDE_PLUGIN_ROOT to it on
  // the next session, so the next hook run resolves against this version.
  this.pluginRoot = stageCache(this.journeyHome, version);
  this.newerVersion = version;
});

// ---- When: uninstall actions (the two orders + recovery) -----------------

// One definition matches both the When ("When the user runs …") and Given ("And
// the user runs …") usages — Cucumber matches step text regardless of keyword.
When('the user runs \\/cc-cream:uninstall', function () {
  // The slash command runs install.js --uninstall from the (still-present) cache.
  this.installResult = runInstall(this.journeyHome, ['--uninstall'], {
    installJs: path.join(this.pluginRoot, 'src', 'install.js'),
  });
  assert.equal(this.installResult.status, 0, `uninstall exited ${this.installResult.status}: ${this.installResult.stderr}`);
});

When('\\/plugin uninstall removes the plugin cache', function () {
  removePluginCache(this.journeyHome);
});

// /cc-cream:setup runs install.js in plugin mode from the cache. One definition
// serves the When and Given usages.
When('the user runs \\/cc-cream:setup', function () {
  this.installResult = runInstall(this.journeyHome, ['--plugin'], {
    installJs: path.join(this.pluginRoot, 'src', 'install.js'),
  });
  assert.equal(this.installResult.status, 0, `setup exited ${this.installResult.status}: ${this.installResult.stderr}`);
});

When('the user runs \\/cc-cream:setup with --force', function () {
  this.installResult = runInstall(this.journeyHome, ['--plugin', '--force'], {
    installJs: path.join(this.pluginRoot, 'src', 'install.js'),
  });
  assert.equal(this.installResult.status, 0, `forced setup exited ${this.installResult.status}: ${this.installResult.stderr}`);
});

When('the plugin is reinstalled in the cache at version {string}', function (version) {
  this.pluginRoot = stageCache(this.journeyHome, version);
});

When('version {string} is pruned from the cache', function (version) {
  removeVersion(this.journeyHome, version);
});

Given('\\/plugin uninstall removed the plugin cache', function () {
  removePluginCache(this.journeyHome);
});

When('the npm bin clears the wiring with the checked-out install.js', function () {
  // The plugin (and its install.js) is gone; the npm bin runs the checked-out copy.
  this.installResult = runInstall(this.journeyHome, ['--uninstall'], {
    installJs: path.join(REPO, 'src', 'install.js'),
  });
  assert.equal(this.installResult.status, 0, `recovery uninstall exited ${this.installResult.status}: ${this.installResult.stderr}`);
});

// ---- Then: assertions -----------------------------------------------------

Then('it announces the bar was enabled', function () {
  assert.ok(this.hookResult.systemMessage, 'expected a systemMessage from the hook');
  assert.match(this.hookResult.systemMessage, /status bar/i);
});

Then("settings.json gains cc-cream's statusLine", function () {
  const sl = statusLineOf(this);
  assert.ok(isCcCream(sl), `expected cc-cream's statusLine, got: ${JSON.stringify(sl)}`);
  assert.equal(sl.refreshInterval, 60);
  this.statusLineCmd = sl.command;
});

Then('running the wired status line command renders the bar', function () {
  // Read the CURRENT wired command (the hook may have re-pinned it to a new version).
  const command = statusLineOf(this).command;
  const res = runStatusLine(this.journeyHome, command);
  assert.equal(res.status, 0, `render exited ${res.status}: ${res.stderr}`);
  assert.ok(res.stdout.includes(MODEL_NAME), `expected the bar to render, got stdout: ${JSON.stringify(res.stdout)} stderr: ${res.stderr}`);
});

Then('the wired status line command resolves to version {string}', function (version) {
  const ep = bakedEntrypoint(statusLineOf(this).command);
  assert.ok(ep.includes(`/${version}/`), `expected the baked entrypoint to point at ${version}, got: ${ep}`);
});

Then('settings.json on disk no longer has a statusLine', function () {
  assert.equal(statusLineOf(this), undefined, `expected no statusLine, got: ${JSON.stringify(statusLineOf(this))}`);
});

Then('settings.json still has no statusLine', function () {
  assert.equal(statusLineOf(this), undefined, `expected no statusLine, got: ${JSON.stringify(statusLineOf(this))}`);
});

Then('no orphaned statusLine remains', function () {
  assert.equal(statusLineOf(this), undefined, `expected no orphaned statusLine, got: ${JSON.stringify(statusLineOf(this))}`);
});

Then('the orphaned statusLine command still lives in settings.json', function () {
  // Documents the residual (CREAM-mgrhufvv): wrong-order uninstall leaves the entry.
  assert.ok(isCcCream(statusLineOf(this)), 'expected the orphaned cc-cream statusLine to still be present');
});

Then('running the wired status line command prints nothing and exits zero', function () {
  const res = runStatusLine(this.journeyHome, this.statusLineCmd);
  assert.equal(res.status, 0, `expected exit 0, got ${res.status}: ${res.stderr}`);
  assert.equal(res.stdout, '', `expected no stdout, got: ${JSON.stringify(res.stdout)}`);
  assert.equal(res.stderr, '', `expected no stderr, got: ${JSON.stringify(res.stderr)}`);
});

Then('the foreign statusLine is left unchanged', function () {
  assert.equal(statusLineOf(this).command, '/usr/bin/my-own-bar.sh', 'foreign statusLine must be untouched');
});

Then('it points the user to \\/cc-cream:setup', function () {
  assert.ok(this.hookResult.systemMessage, 'expected a systemMessage');
  assert.match(this.hookResult.systemMessage, /\/cc-cream:setup/);
});
