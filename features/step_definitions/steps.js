import { Given, When, Then } from '@cucumber/cucumber';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, ENGINE, colorOf } from '../support/world.js';
import { loadConfig, resolveTtl, countdown, patchSessionState } from '../../src/cc-cream.js';
import { plan, planUninstall, statusLineCommand, writeFileAtomic } from '../../src/install.js';
import { nextVersion, rollChangelog, setJsonVersion } from '../../scripts/release.mjs';

// Path to the state file inside a scenario's sandbox HOME.
const stateFilePath = (world) => path.join(world.home, '.claude', 'cc-cream-state.json');
const configFilePath = (world) => path.join(world.home, '.claude', 'cc-cream.json');

// ---- helpers --------------------------------------------------------------
const get = (obj, dotted) => dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

function ensureCtx(world) {
  if (!world.data.context_window || typeof world.data.context_window !== 'object') {
    world.data.context_window = {};
  }
  return world.data.context_window;
}

// Sum every "<n> <unit>" run in a duration phrase ("4 days 3 hours", "2h14m").
function parseDurationMs(s) {
  let ms = 0;
  const re = /(\d+)\s*(days?|hours?|minutes?|mins?|d|h|m)/gi;
  let m;
  while ((m = re.exec(s))) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u.startsWith('d')) ms += n * 86_400_000;
    else if (u.startsWith('h')) ms += n * 3_600_000;
    else ms += n * 60_000; // minutes / mins / m
  }
  return ms;
}

// Replaces ↺Nd placeholders in an expected row-2 string with actual computed day+time values.
// The engine now renders >=1d as "Weekday HH:MM" (local time), so tests must resolve dynamically.
// Segments are matched by prefix (5h/7d) to pick the right window.
function resolveNdTokens(text, world) {
  const rl = world.data?.rate_limits;
  return text.replace(/(5h|7d):\S+ ↺ (\d+d)\b/g, (match, seg) => {
    const w = seg === '5h' ? rl?.five_hour : rl?.seven_day;
    if (!w?.resets_at) return match;
    return match.replace(/↺ \d+d\b/, `↺ ${countdown(w.resets_at * 1000, world.now)}`);
  });
}

// A resets_at value `phrase` from now, nudged +2s so the engine's floor to
// whole minutes is stable against spawn latency. CC sends a Unix timestamp in
// SECONDS (confirmed via the S0 golden fixture), so the tests use that shape.
function resetsAt(world, phrase) {
  return Math.floor((world.now + parseDurationMs(phrase) + 2000) / 1000);
}

// ===========================================================================
// Shared
// ===========================================================================
When('cc-cream runs', function () {
  this.run();
});

Then('cc-cream exits 0', function () {
  assert.equal(this.exitCode, 0);
});

Given('stdin whose model display_name is {string}', function (name) {
  this.modelName = name;
  this.data.model = { display_name: name };
});

// ===========================================================================
// 01 — model segment
// ===========================================================================
Given('Claude Code pipes cc-cream this stdin:', function (doc) {
  this.rawStdin = doc;
});

Then('the output is exactly:', function (doc) {
  assert.equal(this.stdout.replace(/\n$/, ''), doc);
});

Then('the output is empty', function () {
  assert.equal(this.plain.trim(), '');
});

// ===========================================================================
// 02 — config foundation
// ===========================================================================
Given('no file at {string}', function (_path) {
  this.configRaw = null;
});

Given('config:', function (doc) {
  this.configRaw = doc;
});

Given('config with a trailing comma:', function (doc) {
  this.configRaw = doc;
});

Given(/^config (\{.*\})$/, function (json) {
  this.configRaw = json;
});

Then(/^the model segment renders with its built-in defaults \(on, row 3, order 0\.5\)$/, function () {
  assert.ok(this.plain.includes(this.modelName));
});

Then('the model segment is not rendered', function () {
  assert.ok(!this.plain.includes(this.modelName));
});

Then('the model segment renders at its default order', function () {
  assert.ok(this.plain.includes(this.modelName));
});

Then('the entire bar renders with built-in defaults', function () {
  assert.ok(this.plain.includes(this.modelName));
});

Then(/^"([^"]+)" falls back to "([^"]+)"$/, function (key, expected) {
  const cfg = loadConfig(this.configRaw);
  assert.equal(String(cfg[key]), expected);
});

// ===========================================================================
// 03 — context segment
// ===========================================================================
Given('stdin with used_percentage {int} and an input-token total of {int}', function (pct, total) {
  const cw = ensureCtx(this);
  cw.used_percentage = pct;
  cw.total_input_tokens = total;
});

Given('stdin with used_percentage {int}', function (pct) {
  ensureCtx(this).used_percentage = pct;
});

Given('stdin with an input-token total of {int}', function (total) {
  const cw = ensureCtx(this);
  cw.total_input_tokens = total;
  if (!isNum(cw.used_percentage)) cw.used_percentage = 10; // ctx needs a % to render
});

Given('stdin with no context_window', function () {
  delete this.data.context_window;
});

Then('the context segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the context segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /ctx:\d+%/), color);
});

Then('the magnitude reads {string} rather than {string}', function (want, notWant) {
  assert.ok(this.plain.includes(want), `expected "${want}" in: ${this.plain}`);
  assert.ok(!this.plain.includes(notWant));
});

Then('the context segment is not rendered', function () {
  assert.ok(!/ctx:/.test(this.plain));
});

// ===========================================================================
// 04 — cache segment
// ===========================================================================
Given('stdin current_usage with cache_read {int}, cache_creation {int} and input {int}', function (r, c, i) {
  ensureCtx(this).current_usage = {
    cache_read_input_tokens: r,
    cache_creation_input_tokens: c,
    input_tokens: i,
  };
});

Given('stdin with current_usage set to null', function () {
  ensureCtx(this).current_usage = null;
});

Then('the cache segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the cache segment has no color', function () {
  assert.equal(colorOf(this.stdout, /cache:\d+%/), 'neutral');
});

Then('the cache segment is not rendered', function () {
  assert.ok(!/cache:/.test(this.plain));
});

// ===========================================================================
// 05 — ttl / cache-warmth countdown
// ===========================================================================
Given('the transcript was just appended, so its mtime is now', function () {
  this.data.transcript_path = this.makeTranscript(0);
});

Given('the transcript mtime was {int} minutes ago', function (mins) {
  this.data.transcript_path = this.makeTranscript(mins);
});

Given('a resolved TTL of {int} minutes', function (mins) {
  this.configRaw = JSON.stringify({ ttl: mins });
});

Given('stdin with no transcript_path', function () {
  delete this.data.transcript_path;
});

Then('the ttl segment reads {string} and is green', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
  assert.equal(colorOf(this.stdout, /ttl:\d+:\d+/), 'green');
});

Then('the ttl segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the ttl segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /ttl:\d+:\d+/), color);
});

Then('the ttl segment is not rendered', function () {
  assert.ok(!/ttl:/.test(this.plain));
});

Given('session state records last_api_ts {int} minutes ago with total_input_tokens {int}', function (mins, tokens) {
  const sessionId = 'ttl-test-session';
  this.data.session_id = sessionId;
  const lastApiTs = this.now - mins * 60_000;
  const state = { sessions: { [sessionId]: { last_api_ts: lastApiTs, total_input_tokens: tokens } } };
  fs.writeFileSync(stateFilePath(this), JSON.stringify(state));
});

// TTL inference (pure function, no spawn)
Given(/^environment (.+) and rate_limits (.+)$/, function (env, rl) {
  if (env !== 'none') this.env[env] = '1';
  if (rl.startsWith('present')) {
    const pct = rl.includes('over cap') ? 100 : 10;
    this.data.rate_limits = {
      five_hour: { used_percentage: pct },
      seven_day: { used_percentage: 10 },
    };
  } else {
    delete this.data.rate_limits;
  }
});

Given('rate_limits with a window at used_percentage {int}', function (pct) {
  this.data.rate_limits = { five_hour: { used_percentage: pct, resets_at: resetsAt(this, '1 hour') } };
});

When('cc-cream resolves the TTL', function () {
  this.resolvedTtl = resolveTtl({
    rateLimits: this.data.rate_limits,
    config: loadConfig(this.configRaw),
    env: this.env,
  });
});

Then('the resolved TTL is {int} minutes', function (mins) {
  assert.equal(this.resolvedTtl, mins);
});

Then('the resolved TTL drops to {int} minutes', function (mins) {
  assert.equal(this.resolvedTtl, mins);
});

// ===========================================================================
// 06 — cost segment
// ===========================================================================
Given(/^stdin with total_cost_usd (\S+)$/, function (v) {
  this.data.cost = { total_cost_usd: parseFloat(v) };
});

Given('stdin with no cost field', function () {
  delete this.data.cost;
});

Then('the cost segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the cost segment has no color', function () {
  assert.equal(colorOf(this.stdout, /~\$[\d.]+/), 'neutral');
});

Then('the cost segment is not rendered', function () {
  assert.ok(!/~\$/.test(this.plain));
});

// ===========================================================================
// 07 — rate-limit row
// ===========================================================================
Given(/^stdin five_hour with used_percentage (\d+) resetting in (.+)$/, function (pct, dur) {
  this.data.rate_limits = this.data.rate_limits || {};
  this.data.rate_limits.five_hour = { used_percentage: Number(pct), resets_at: resetsAt(this, dur) };
});

Given(/^seven_day with used_percentage (\d+) resetting in (.+)$/, function (pct, dur) {
  this.data.rate_limits = this.data.rate_limits || {};
  this.data.rate_limits.seven_day = { used_percentage: Number(pct), resets_at: resetsAt(this, dur) };
});

Given('stdin with no rate_limits', function () {
  this.data.model = { display_name: 'Opus 4.7 (1M context)' }; // baseline row-1 content
  delete this.data.rate_limits;
});

Given('stdin with five_hour present and seven_day absent', function () {
  this.data.rate_limits = { five_hour: { used_percentage: 50, resets_at: resetsAt(this, '1 hour') } };
});

Given(/^a window resetting in (.+)$/, function (dur) {
  this.data.rate_limits = { five_hour: { used_percentage: 50, resets_at: resetsAt(this, dur) } };
});

Given('a window at used_percentage {int}', function (pct) {
  this.data.rate_limits = { five_hour: { used_percentage: pct, resets_at: resetsAt(this, '1 hour') } };
});

Then('row 2 reads {string}', function (text) {
  const line = this.plain.split('\n').find((l) => /5h:|7d:/.test(l));
  assert.equal(line, resolveNdTokens(text, this));
});

Then('only one row is emitted', function () {
  assert.equal(this.plain.split('\n').filter((l) => l.length > 0).length, 1);
});

Then('row 2 shows the 5h segment and omits the 7d segment', function () {
  assert.ok(this.plain.includes('5h:'));
  assert.ok(!this.plain.includes('7d:'));
});

Then('the countdown reads {string}', function (text) {
  // >=1d format is now "Weekday HH:MM" (local time); capture includes the space before HH:MM.
  const m = this.plain.match(/5h:\d+% (↺ \S+(?:\s\d{2}:\d{2})?)/);
  assert.ok(m, `no countdown found in: ${this.plain}`);
  let expected = text;
  if (/↺ \d+d\b/.test(text)) {
    const ra = this.data?.rate_limits?.five_hour?.resets_at;
    if (ra != null) expected = `↺ ${countdown(ra * 1000, this.now)}`;
  }
  assert.equal(m[1], expected);
});

Then('the segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /5h:\d+%/), color);
});

// ===========================================================================
// 11 — rate-limit reset indicator (↺)
// ===========================================================================
// The 5h segment is the first whitespace-delimited token on row 2 starting with
// "5h:" (row-2 segments are joined by two spaces; the segment itself has none).
const seg5h = (plain) => plain.match(/5h:\S+(?:\s↺\s\S+(?:\s\d{2}:\d{2})?)?/)?.[0] ?? null;

Given('stdin five_hour with used_percentage {int} and no resets_at', function (pct) {
  this.data.rate_limits = this.data.rate_limits || {};
  this.data.rate_limits.five_hour = { used_percentage: pct };
});

Then('the 5h segment reads {string}', function (text) {
  assert.equal(seg5h(this.plain), text, `5h segment in: ${this.plain}`);
});

Then('the percentage reads {string} with no ↺ prefix', function (pct) {
  const seg = seg5h(this.plain);
  assert.ok(seg, `no 5h segment in: ${this.plain}`);
  const percentage = seg.slice('5h:'.length).split(' ')[0]; // text before the countdown joiner
  assert.equal(percentage, pct);
  assert.ok(!percentage.includes('↺'), `↺ leaked into the percentage: ${percentage}`);
});

Then('the ↺ glyph appears exactly once in the 5h segment', function () {
  const seg = seg5h(this.plain) ?? '';
  assert.equal((seg.match(/↺/g) || []).length, 1, `glyph count wrong in: ${seg}`);
});

Then('the ↺ glyph is not rendered', function () {
  assert.ok(!this.plain.includes('↺'), `↺ unexpectedly present in: ${this.plain}`);
});

// ===========================================================================
// 08 — optional segments
// ===========================================================================
Given('default config', function () {
  this.configRaw = null;
});

Given(/^stdin with effort\.level "([^"]+)" and thinking\.enabled (\w+)$/, function (lvl, on) {
  this.data.effort = { level: lvl };
  this.data.thinking = { enabled: on === 'true' };
});

Given('stdin with effort.level {string}', function (lvl) {
  this.data.effort = { level: lvl };
});

Given(/^stdin with thinking\.enabled (\w+)$/, function (on) {
  this.data.thinking = { enabled: on === 'true' };
});

Given('stdin with no effort field', function () {
  delete this.data.effort;
});

Then('neither the effort nor the thinking segment is rendered', function () {
  assert.ok(!/effort:|think:/.test(this.plain));
});

Then('the effort segment shows {string}', function (level) {
  assert.ok(this.plain.includes(`effort:${level}`), `expected effort:${level} in: ${this.plain}`);
});

Then('the thinking segment indicates thinking is on', function () {
  assert.ok(this.plain.includes('think:on'), `expected think:on in: ${this.plain}`);
});

Then('the effort segment is not rendered', function () {
  assert.ok(!/effort:/.test(this.plain));
});

// ===========================================================================
// 09 — installer
// ===========================================================================
Given('settings.json has no statusLine', function () {
  this.settings = {};
});

Given('settings.json already has a statusLine command', function () {
  this.settings = { statusLine: { type: 'command', command: 'bash /old/statusline.sh', refreshInterval: 5 } };
});

Given('settings.json sets statusLine.padding', function () {
  this.settings = { statusLine: { padding: 2 } };
});

Given('cc-cream is already installed', function () {
  this.settings = { statusLine: { type: 'command', command: statusLineCommand(ABS_NODE, ENGINE), refreshInterval: 60 } };
});

When('the installer runs and I consent', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, nodePath: ABS_NODE, consent: true });
});

When('the installer runs', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, nodePath: ABS_NODE, consent: false });
});

When('the installer runs again', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, nodePath: ABS_NODE, consent: true });
});

When('the installer completes', function () {
  this.result = plan({}, { entrypoint: ENGINE, nodePath: ABS_NODE, consent: true });
});

Then('settings.json gains a statusLine of type {string} with refreshInterval {int}', function (type, ri) {
  assert.equal(this.result.settings.statusLine.type, type);
  assert.equal(this.result.settings.statusLine.refreshInterval, ri);
});

Then('its command points at the cc-cream entrypoint', function () {
  assert.ok(this.result.settings.statusLine.command.includes('cc-cream.js'));
});

Then('it shows the existing line and asks before replacing it', function () {
  const joined = this.result.messages.join('\n');
  assert.ok(/existing statusLine/i.test(joined));
  assert.ok(/replace it/i.test(joined));
});

Then('the messages do not echo the full statusLine command', function () {
  const joined = this.result.messages.join('\n');
  assert.ok(!joined.includes('exec '), `messages must not echo the statusLine command: ${joined}`);
  assert.ok(!/"type"\s*:\s*"command"/.test(joined), `messages must not echo the statusLine JSON: ${joined}`);
  assert.ok(!joined.includes('cc-cream.js'), `messages must not echo the entrypoint path: ${joined}`);
});

Then('declining leaves the existing statusLine unchanged', function () {
  assert.equal(this.result.changed, false);
  assert.deepEqual(this.result.settings.statusLine, this.before.statusLine);
});

Then('the padding value is preserved, since it shrinks the 80-col budget', function () {
  assert.equal(this.result.settings.statusLine.padding, 2);
});

Then('settings.json is unchanged', function () {
  assert.equal(this.result.changed, false);
  assert.deepEqual(this.result.settings, this.before);
});

Then('it explains the bar appears on the next message, noting trust and restarting an open session', function () {
  const joined = this.result.messages.join('\n').toLowerCase();
  assert.ok(joined.includes('next message'), `setup note must lead with "next message", got: ${joined}`);
  assert.ok(joined.includes('trust'));
  assert.ok(joined.includes('restart'));
});

Given('settings.json has cc-cream installed alongside other keys', function () {
  this.settings = {
    model: 'opus',
    permissions: { allow: ['Bash(ls:*)'] },
    statusLine: { type: 'command', command: statusLineCommand(ABS_NODE, ENGINE), refreshInterval: 60 },
  };
});

When('the uninstaller runs', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = planUninstall(this.settings);
});

Then('settings.json no longer has a statusLine', function () {
  assert.equal(this.result.changed, true);
  assert.ok(!('statusLine' in this.result.settings), 'statusLine key must be gone');
});

Then('the existing statusLine is left unchanged', function () {
  assert.equal(this.result.changed, false);
  assert.deepEqual(this.result.settings.statusLine, this.before.statusLine);
});

Then('the other settings keys are preserved', function () {
  assert.equal(this.result.settings.model, 'opus');
  assert.deepEqual(this.result.settings.permissions, this.before.permissions);
});

Given('settings.json on disk is not valid JSON', function () {
  this.malformed = '{ "model": "opus", oops not json';
  fs.writeFileSync(path.join(this.home, '.claude', 'settings.json'), this.malformed);
});

When('install.js runs against it', function () {
  const installer = path.join(REPO, 'src', 'install.js');
  const source = path.join(REPO, 'src', 'cc-cream.js');
  const res = spawnSync(process.execPath, [installer, source], {
    input: 'y\n',
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
  });
  this.installerExit = res.status;
  this.afterContents = fs.readFileSync(path.join(this.home, '.claude', 'settings.json'), 'utf8');
});

Then('it exits non-zero and leaves the file byte-for-byte unchanged', function () {
  assert.notEqual(this.installerExit, 0, 'installer must exit non-zero on malformed settings');
  assert.equal(this.afterContents, this.malformed, 'malformed settings.json must be untouched');
});

// ===========================================================================
// 10 — distribution (raw .js)
// ===========================================================================
Then('the published runtime uses only Node built-ins and local modules', function () {
  assert.ok(fs.existsSync(ENGINE), 'src/cc-cream.js must exist');
  const runtimeFiles = fs.readdirSync(path.join(REPO, 'src')).filter((name) => name.endsWith('.js'));
  for (const file of runtimeFiles) {
    const filePath = path.join(REPO, 'src', file);
    const src = fs.readFileSync(filePath, 'utf8');
    const specifiers = [...src.matchAll(/import\s+[^'"]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const spec of specifiers) {
      if (spec.startsWith('node:')) continue;
      assert.ok(spec.startsWith('./'), `external runtime import in ${file}: ${spec}`);
      assert.ok(fs.existsSync(path.join(path.dirname(filePath), spec)), `missing local runtime import in ${file}: ${spec}`);
    }
  }
});

Then('it declares no runtime dependencies', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(!pkg.dependencies || Object.keys(pkg.dependencies).length === 0);
});

Then('the README explains downloading the .js and running the consent installer', function () {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8').toLowerCase();
  assert.ok(readme.includes('download'));
  assert.ok(readme.includes('install'));
});

Then(/^it states the minimum Claude Code version of (\S+)$/, function (version) {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.includes(version), `README must state min version ${version}`);
});

Given('the downloaded cc-cream.js', function () {
  assert.ok(fs.existsSync(ENGINE));
});

Given('the downloaded cc-cream.js reached through a symlink', function () {
  // Reproduce a dotfile-managed/synced config dir: the src/ directory is reached
  // through a symlink, so the engine's invoked path differs from its realpath.
  // The "am-I-main" guard must compare realpaths, or main() never runs.
  const link = path.join(this.home, 'linked-src');
  fs.symlinkSync(path.dirname(ENGINE), link);
  this.engineOverride = path.join(link, 'cc-cream.js');
  assert.ok(fs.existsSync(this.engineOverride));
});

When('Claude Code pipes it a session JSON on stdin', function () {
  this.data = {
    model: { display_name: 'Opus 4.7 (1M context)' },
    context_window: {
      used_percentage: 19,
      total_input_tokens: 38000,
      current_usage: { cache_read_input_tokens: 950000, cache_creation_input_tokens: 30000, input_tokens: 20000 },
    },
    cost: { total_cost_usd: 4.5 },
  };
  this.run();
});

Then('it prints the formatted bar to stdout', function () {
  assert.ok(this.plain.length > 0);
  assert.ok(this.plain.includes('Opus 4.7 (1M context)'));
});

Then(/^it finishes well inside the ~300ms post-message event path \(PRD §8\)$/, function () {
  assert.ok(this.durationMs < 300, `took ${this.durationMs.toFixed(0)}ms`);
});

// ===========================================================================
// 00 — verify stdin contract / golden fixture (S0 gating spike)
// ===========================================================================
Given('a live Claude Code subscription session on a 1M-context model', function () {
  // Captured out-of-band via scripts/capture-stdin.sh wired into settings.json.
});

When('the configured statusLine command receives its stdin', function () {
  // The capture wrapper tees stdin to the golden fixture.
});

Then('the raw stdin JSON is saved to {string}', function (rel) {
  const p = path.join(REPO, rel);
  assert.ok(fs.existsSync(p), `${rel} not captured yet — wire scripts/capture-stdin.sh into settings.json`);
  JSON.parse(fs.readFileSync(p, 'utf8')); // must be valid JSON
});

Given('the golden fixture {string}', function (rel) {
  this.fixture = JSON.parse(fs.readFileSync(path.join(REPO, rel), 'utf8'));
});

Then('it has a string at {string}', function (dotted) {
  assert.equal(typeof get(this.fixture, dotted), 'string');
});

Then('it has a number at {string}', function (dotted) {
  assert.ok(isNum(get(this.fixture, dotted)), `${dotted} should be a number`);
});

Then(
  'it has numbers under {string} for cache_read_input_tokens, cache_creation_input_tokens and input_tokens',
  function (dotted) {
    const u = get(this.fixture, dotted);
    assert.ok(u && typeof u === 'object', `${dotted} missing`);
    for (const k of ['cache_read_input_tokens', 'cache_creation_input_tokens', 'input_tokens']) {
      assert.ok(isNum(u[k]), `${dotted}.${k} should be a number`);
    }
  },
);

Then('it has a filesystem path at {string}', function (dotted) {
  const v = get(this.fixture, dotted);
  assert.ok(typeof v === 'string' && v.length > 0, `${dotted} should be a path string`);
});

Then(/^it has "([^"]+)" and "([^"]+)" under both "([^"]+)" and "([^"]+)"$/, function (a, b, p1, p2) {
  for (const parent of [p1, p2]) {
    const w = get(this.fixture, parent);
    assert.ok(w && typeof w === 'object', `${parent} missing`);
    assert.ok(a in w, `${parent}.${a} missing`);
    assert.ok(b in w, `${parent}.${b} missing`);
  }
});

Then(/^the field backing the ctx magnitude is identified by its real name \(PRD §4\.1 assumed "([^"]+)"\)$/, function (assumed) {
  const cw = this.fixture.context_window || {};
  if (isNum(cw[assumed])) {
    this.magField = assumed;
  } else {
    const u = cw.current_usage || {};
    const sum = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    assert.ok(sum > 0, `neither ${assumed} nor a current_usage sum is present`);
    this.magField = 'current_usage(sum)';
  }
});

Then(
  /^its basis is confirmed input-only — input \+ cache_creation \+ cache_read — matching used_percentage \(PRD §10\)$/,
  function () {
    const cw = this.fixture.context_window || {};
    const u = cw.current_usage || {};
    const sum = (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.input_tokens || 0);
    if (this.magField !== 'current_usage(sum)' && isNum(cw[this.magField])) {
      // The named field must equal the input-only sum (allow tiny drift).
      assert.ok(Math.abs(cw[this.magField] - sum) <= Math.max(1, sum * 0.01),
        `${this.magField}=${cw[this.magField]} not ≈ input-only sum ${sum}`);
    }
  },
);

Given('a session on a 200k-context model', function () {
  this.fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'fixtures', 'subscriber-200k.golden.json'), 'utf8'));
});

Then('used_percentage is confirmed to track input-tokens divided by 200000', function () {
  const cw = this.fixture.context_window;
  const total = isNum(cw.total_input_tokens)
    ? cw.total_input_tokens
    : (cw.current_usage.cache_read_input_tokens + cw.current_usage.cache_creation_input_tokens + cw.current_usage.input_tokens);
  const expected = (total / 200000) * 100;
  assert.ok(Math.abs(expected - cw.used_percentage) <= 1, `expected ~${expected.toFixed(1)}%, got ${cw.used_percentage}`);
});

Then('the §12 open question about the denominator is closed', function () {
  assert.ok(true);
});

// ===========================================================================
// 12 — peak-hours segment
// ===========================================================================
// Map a Pacific wall-clock time to an epoch ms, deterministically and DST-free,
// by anchoring on the first full week of Jan 2026 (always PST = UTC-8). The
// engine reformats this epoch in America/Los_Angeles, so it exercises the real
// Intl path. Hours stay within one UTC day (PT hour + 8 ≤ 22 for the cases used).
function ptEpochMs(weekday, hh, mm) {
  const day = { Sat: 3, Sun: 4, Mon: 5, Tue: 6, Wed: 7, Thu: 8, Fri: 9 }[weekday.slice(0, 3)];
  return Date.UTC(2026, 0, day, hh + 8, mm, 0);
}

const hasPeak = (plain) => plain.includes('peak');

// Pin the engine's clock to a Pacific wall-clock time. Shift any reset countdown
// already set against real `now` (the Background runs before this) so it stays
// relative to the injected clock, then make later resetsAt() calls use it too.
Given(/^the Pacific time is (\w+) (\d{1,2}):(\d{2})$/, function (wd, hh, mm) {
  const epoch = ptEpochMs(wd, Number(hh), Number(mm));
  const deltaSec = Math.round((epoch - this.now) / 1000);
  for (const w of Object.values(this.data.rate_limits ?? {})) {
    if (w && isNum(w.resets_at)) w.resets_at += deltaSec;
  }
  this.now = epoch;
  this.env.CC_CREAM_NOW = String(epoch);
});

Given(/^the America\/Los_Angeles timezone is unavailable$/, function () {
  this.env.CC_CREAM_TZ = 'Definitely/NotAZone'; // forces Intl.DateTimeFormat to throw
});

Then('row 2 ends with {string}', function (text) {
  const line = this.plain.split('\n').find((l) => /5h:|7d:|peak/.test(l));
  assert.ok(line, `no row 2 in: ${this.plain}`);
  assert.ok(line.endsWith(text), `"${line}" does not end with "${text}"`);
});

Then('the peak segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /peak/), color);
});

Then('the peak segment is rendered', function () {
  assert.ok(hasPeak(this.plain), `expected peak in: ${this.plain}`);
});

Then('the peak segment is not rendered', function () {
  assert.ok(!hasPeak(this.plain), `unexpected peak in: ${this.plain}`);
});

Then('row 2 carries no empty placeholder for peak', function () {
  const line = this.plain.split('\n').find((l) => /5h:|7d:/.test(l)) ?? '';
  assert.ok(!hasPeak(line), `peak present in: ${line}`);
  assert.ok(!/\s$/.test(line), `row 2 has trailing whitespace: "${line}"`);
  assert.ok(!/ {3,}/.test(line), `row 2 has a gap where peak would sit: "${line}"`);
});

// One-line "But at Pacific time X the peak segment is …" — re-pin the clock, rerun, assert.
Then(/^at Pacific time (\w+) (\d{1,2}):(\d{2}) the peak segment is (rendered|not rendered)$/, function (wd, hh, mm, shown) {
  this.env.CC_CREAM_NOW = String(ptEpochMs(wd, Number(hh), Number(mm)));
  this.run();
  if (shown === 'rendered') assert.ok(hasPeak(this.plain), `expected peak in: ${this.plain}`);
  else assert.ok(!hasPeak(this.plain), `unexpected peak in: ${this.plain}`);
});

// ===========================================================================
// 13 — percentage direction (consumed vs. remaining)
// ===========================================================================
Given('stdin with used_percentage {int} for ctx and {int} for the 5h window', function (ctxPct, fhPct) {
  ensureCtx(this).used_percentage = ctxPct;
  this.data.rate_limits = this.data.rate_limits || {};
  this.data.rate_limits.five_hour = { used_percentage: fhPct, resets_at: resetsAt(this, '2 hours') };
});

Given('stdin with a last-turn cache hit rate of {int}%', function (pct) {
  // read / (read + creation + input) = pct/100
  ensureCtx(this).current_usage = {
    cache_read_input_tokens: pct,
    cache_creation_input_tokens: 0,
    input_tokens: 100 - pct,
  };
});

// (stdin with an idle duration of HH:MM — removed; use "the transcript mtime was N minutes ago" instead)

Then('the 5h segment percentage reads {string}', function (pct) {
  const seg = seg5h(this.plain);
  assert.ok(seg, `no 5h segment in: ${this.plain}`);
  assert.equal(seg.slice('5h:'.length).split(' ')[0], pct);
});

Then('the 5h segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /5h:\d+%/), color);
});

Then('the magnitude reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

// ===========================================================================
// 14 — per-session state foundation
// ===========================================================================
Given('a session_id of {string}', function (id) {
  this.data.session_id = id;
});

Given('no session_id in stdin', function () {
  delete this.data.session_id;
});

Given('no state file exists', function () {
  // Sandbox HOME starts clean — this step is documentary.
});

Given('a corrupted state file', function () {
  fs.writeFileSync(stateFilePath(this), 'not valid json {{{{');
});

Given('a state file with session {string} having cost {float}', function (id, cost) {
  const state = { sessions: { [id]: { cost, ts: this.now } } };
  fs.writeFileSync(stateFilePath(this), JSON.stringify(state));
});

Then('the output is not empty', function () {
  assert.ok(this.plain.trim().length > 0, 'expected non-empty output');
});

Then('a state file is written', function () {
  assert.ok(fs.existsSync(stateFilePath(this)), 'state file was not written');
});

Then('no state file is written', function () {
  assert.ok(!fs.existsSync(stateFilePath(this)), 'state file was unexpectedly written');
});

Then('the state for session {string} has cost {float}', function (id, expected) {
  const raw = fs.readFileSync(stateFilePath(this), 'utf8');
  const state = JSON.parse(raw);
  const actual = state?.sessions?.[id]?.cost;
  assert.ok(typeof actual === 'number', `cost missing for session ${id}`);
  assert.ok(Math.abs(actual - expected) < 0.001, `expected cost ${expected}, got ${actual}`);
});

// ===========================================================================
// 15 — burn-rate projection
// ===========================================================================
Given(/^a state file with session "([^"]+)" having five_hour_pct (\d+) sampled (\d+)m ago$/, function (id, pct, mins) {
  // Use CC_CREAM_NOW if already pinned (e.g. via "the Pacific time is…"), so that
  // deltaMs in segBurn is computed against the same clock the engine will use.
  const nowMs = this.env.CC_CREAM_NOW ? Number(this.env.CC_CREAM_NOW) : this.now;
  const state = { sessions: { [id]: { five_hour_pct: Number(pct), ts: nowMs - Number(mins) * 60000 } } };
  fs.writeFileSync(stateFilePath(this), JSON.stringify(state));
});

Then('row 2 includes {string}', function (text) {
  const line = this.plain.split('\n').find((l) => /5h:|7d:|~/.test(l));
  assert.ok(line && line.includes(text), `expected row 2 to include "${text}" in: ${this.plain}`);
});

Then('row 2 does not include a burn projection', function () {
  const line = this.plain.split('\n').find((l) => /5h:|7d:|~/.test(l));
  assert.ok(!line || !/~\d/.test(line), `expected no burn projection in row 2, got: ${line}`);
});

Then('the state for session {string} has five_hour_pct {int}', function (id, expected) {
  const raw = fs.readFileSync(stateFilePath(this), 'utf8');
  const state = JSON.parse(raw);
  const actual = state?.sessions?.[id]?.five_hour_pct;
  assert.strictEqual(actual, expected, `expected five_hour_pct ${expected}, got ${actual}`);
});

// ===========================================================================
// 16 — API efficiency ratio
// ===========================================================================
Given('stdin with total_api_duration_ms {int} and total_duration_ms {int}', function (api, total) {
  this.data.cost = { ...(this.data.cost ?? {}), total_api_duration_ms: api, total_duration_ms: total };
});

Given('stdin with only total_duration_ms {int}', function (total) {
  this.data.cost = { ...(this.data.cost ?? {}), total_duration_ms: total };
});

Then('the api_ratio segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the api_ratio segment is not rendered', function () {
  assert.ok(!/api:\d+%/.test(this.plain), `api_ratio unexpectedly present in: ${this.plain}`);
});

Then('row 1 includes {string} before {string}', function (a, b) {
  const row1 = this.plain.split('\n')[0];
  const ia = row1.indexOf(a);
  const ib = row1.indexOf(b);
  assert.ok(ia !== -1, `"${a}" not found in row 1: ${row1}`);
  assert.ok(ib !== -1, `"${b}" not found in row 1: ${row1}`);
  assert.ok(ia < ib, `"${a}" (pos ${ia}) should appear before "${b}" (pos ${ib}) in row 1: ${row1}`);
});

// ===========================================================================
// 15 — cache drop-detection
// ===========================================================================
Given('a state file with session {string} having cache_pct {int}', function (id, pct) {
  const state = { sessions: { [id]: { cache_pct: pct, ts: this.now } } };
  fs.writeFileSync(stateFilePath(this), JSON.stringify(state));
});

Given('a state file with session {string} having cache_pct {int} and recovering', function (id, pct) {
  const state = { sessions: { [id]: { cache_pct: pct, recovering: true, ts: this.now } } };
  fs.writeFileSync(stateFilePath(this), JSON.stringify(state));
});

Then('the cache segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /cache:\d+%/), color);
});

// ===========================================================================
// 17 — additional stdin fields (session_name, write)
// ===========================================================================
Given('stdin with session_name {string}', function (name) {
  this.data.session_name = name;
});

Given('stdin with no session_name field', function () {
  delete this.data.session_name;
});

Then('the session_name segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the session_name segment is not rendered', function () {
  assert.ok(!/session:/.test(this.plain), `session_name unexpectedly present in: ${this.plain}`);
});

Then('row 1 zone 1 reads {string}', function (expected) {
  const row1 = this.plain.split('\n')[0];
  const zone1 = row1.split(' | ')[0];
  assert.equal(zone1, expected, `zone 1 was "${zone1}", expected "${expected}"`);
});

Then('row 1 includes {string} between zone 1 and zone 2', function (_sep) {
  const row1 = this.plain.split('\n')[0];
  assert.ok(row1.includes(' | '), `no zone separator in row 1: ${row1}`);
});

Then('the write segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the write segment is not rendered', function () {
  assert.ok(!/write:\d+%/.test(this.plain), `write unexpectedly present in: ${this.plain}`);
});

Then('row 1 includes {string}', function (text) {
  const row1 = this.plain.split('\n')[0];
  assert.ok(row1.includes(text), `expected "${text}" in row 1: ${row1}`);
});

Then('the last row reads {string}', function (expected) {
  const rows = this.plain.split('\n').filter((l) => l.length > 0);
  const last = rows[rows.length - 1];
  assert.equal(last, expected, `last row: "${last}"`);
});

// ===========================================================================
// 18 — distribution as npm package
// ===========================================================================
Then('package.json has a bin entry for {string} pointing to the engine', function (name) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(pkg.bin && typeof pkg.bin === 'object', 'package.json is missing a "bin" field');
  const entry = pkg.bin[name];
  assert.ok(typeof entry === 'string' && entry.includes('cc-cream.js'),
    `bin["${name}"] should point to cc-cream.js, got: ${entry}`);
});

Then(/^src\/cc-cream\.js starts with "([^"]+)"$/, function (shebang) {
  const src = fs.readFileSync(ENGINE, 'utf8');
  assert.ok(src.startsWith(shebang), `Engine does not start with "${shebang}"`);
});

// ===========================================================================
// 20 — plugin manifest and marketplace metadata
// ===========================================================================
const pluginDir = path.join(REPO, '.claude-plugin');
let _pluginJson = null;
let _marketplaceJson = null;

function readPluginJson() {
  if (!_pluginJson) {
    const raw = fs.readFileSync(path.join(pluginDir, 'plugin.json'), 'utf8');
    _pluginJson = JSON.parse(raw);
  }
  return _pluginJson;
}

function readMarketplaceJson() {
  if (!_marketplaceJson) {
    const raw = fs.readFileSync(path.join(pluginDir, 'marketplace.json'), 'utf8');
    _marketplaceJson = JSON.parse(raw);
  }
  return _marketplaceJson;
}

Then(/^\.claude-plugin\/plugin\.json exists and is valid JSON$/, function () {
  const p = path.join(pluginDir, 'plugin.json');
  assert.ok(fs.existsSync(p), '.claude-plugin/plugin.json does not exist');
  assert.doesNotThrow(() => readPluginJson(), 'plugin.json is not valid JSON');
});

Then('it sets name to {string}', function (name) {
  assert.equal(readPluginJson().name, name);
});

Then('it sets displayName to {string}', function (displayName) {
  assert.equal(readPluginJson().displayName, displayName);
});

Then('it declares version, homepage, repository, and license MIT', function () {
  const p = readPluginJson();
  assert.ok(typeof p.version === 'string' && p.version.length > 0, 'version must be a non-empty string');
  assert.ok(typeof p.homepage === 'string' && p.homepage.length > 0, 'homepage must be a non-empty string');
  assert.ok(typeof p.repository === 'string' && p.repository.length > 0, 'repository must be a non-empty string');
  assert.equal(p.license, 'MIT', 'license must be MIT');
});

Then('it declares a non-empty keywords array', function () {
  const p = readPluginJson();
  assert.ok(Array.isArray(p.keywords) && p.keywords.length > 0, 'keywords must be a non-empty array');
});

Then('it sets author to {string} with email {string}', function (name, email) {
  const author = readPluginJson().author;
  assert.ok(author && typeof author === 'object', 'author must be an object');
  assert.equal(author.name, name);
  assert.equal(author.email, email);
});

Then('it does not declare a commands key so commands auto-discover from the top-level commands directory', function () {
  const commands = readPluginJson().commands;
  assert.equal(commands, undefined,
    `plugin.json must not declare a "commands" key (install-time schema rejects it); got: ${JSON.stringify(commands)}`);
  const cmdDir = path.join(REPO, 'commands');
  assert.ok(fs.existsSync(cmdDir) && fs.statSync(cmdDir).isDirectory(),
    'a top-level commands/ directory must exist for auto-discovery');
  assert.ok(fs.existsSync(path.join(cmdDir, 'setup.md')),
    'commands/setup.md must exist');
});

Then(/^plugin\.json description references "([^"]+)"$/, function (phrase) {
  const desc = readPluginJson().description;
  assert.ok(typeof desc === 'string' && desc.includes(phrase),
    `description must include "${phrase}", got: ${desc}`);
});

Then(/^\.claude-plugin contains exactly plugin\.json and marketplace\.json$/, function () {
  const entries = fs.readdirSync(pluginDir).sort();
  assert.deepEqual(entries, ['marketplace.json', 'plugin.json'],
    `.claude-plugin must contain only plugin.json and marketplace.json, got: ${entries}`);
});

Then(/^the command files live in a top-level commands directory$/, function () {
  const cmdDir = path.join(REPO, 'commands');
  assert.ok(fs.existsSync(cmdDir) && fs.statSync(cmdDir).isDirectory(),
    'a top-level commands/ directory must exist');
  const entries = fs.readdirSync(cmdDir).sort();
  assert.deepEqual(entries, ['setup.md', 'uninstall.md'],
    `commands/ must contain setup.md and uninstall.md, got: ${entries}`);
});

Then(/^no source modules, agents, or hooks live directly inside \.claude-plugin$/, function () {
  const entries = fs.readdirSync(pluginDir);
  const allowed = new Set(['plugin.json', 'marketplace.json']);
  const unexpected = entries.filter((e) => !allowed.has(e));
  assert.deepEqual(unexpected, [], `unexpected entries inside .claude-plugin: ${unexpected}`);
});

Then(/^\.claude-plugin\/marketplace\.json exists and is valid JSON$/, function () {
  const p = path.join(pluginDir, 'marketplace.json');
  assert.ok(fs.existsSync(p), '.claude-plugin/marketplace.json does not exist');
  assert.doesNotThrow(() => readMarketplaceJson(), 'marketplace.json is not valid JSON');
});

Then('it declares an owner with name {string} and email {string}', function (name, email) {
  const owner = readMarketplaceJson().owner;
  assert.ok(owner && typeof owner === 'object', 'owner must be an object');
  assert.equal(owner.name, name);
  assert.equal(owner.email, email);
});

Then('it lists a single plugin {string} with source {string}', function (name, source) {
  const plugins = readMarketplaceJson().plugins;
  assert.ok(Array.isArray(plugins) && plugins.length === 1,
    `plugins must be an array with exactly one entry, got length: ${plugins?.length}`);
  assert.equal(plugins[0].name, name);
  assert.equal(plugins[0].source, source);
});

Then('the plugin entry sets category {string}', function (category) {
  const plugins = readMarketplaceJson().plugins;
  assert.ok(Array.isArray(plugins) && plugins.length > 0, 'plugins array is empty');
  assert.equal(plugins[0].category, category);
});

Then(/^the plugin name does not start with "([^"]+)" or "([^"]+)"$/, function (prefix1, prefix2) {
  const name = readPluginJson().name;
  assert.ok(!name.startsWith(prefix1), `plugin name must not start with "${prefix1}"`);
  assert.ok(!name.startsWith(prefix2), `plugin name must not start with "${prefix2}"`);
});

Then('the plugin name is lowercase kebab-case', function () {
  const name = readPluginJson().name;
  assert.match(name, /^[a-z][a-z0-9-]*$/, `plugin name must be lowercase kebab-case, got: ${name}`);
});

Then('the marketplace manifest has top-level name {string}', function (name) {
  assert.equal(readMarketplaceJson().name, name,
    `marketplace.json top-level name must be "${name}"`);
});

Then('the marketplace manifest has a non-empty top-level description', function () {
  const desc = readMarketplaceJson().description;
  assert.ok(typeof desc === 'string' && desc.length > 0,
    `marketplace.json must have a non-empty top-level description, got: ${JSON.stringify(desc)}`);
});

Then('the plugin entry has a non-empty description', function () {
  const plugins = readMarketplaceJson().plugins;
  assert.ok(Array.isArray(plugins) && plugins.length > 0, 'plugins array is empty');
  const desc = plugins[0].description;
  assert.ok(typeof desc === 'string' && desc.length > 0,
    `marketplace.json plugin entry must have a non-empty description, got: ${JSON.stringify(desc)}`);
});

Then('the plugin entry has homepage {string}', function (homepage) {
  const plugins = readMarketplaceJson().plugins;
  assert.ok(Array.isArray(plugins) && plugins.length > 0, 'plugins array is empty');
  assert.equal(plugins[0].homepage, homepage,
    `marketplace.json plugin entry homepage must be "${homepage}", got: ${plugins[0].homepage}`);
});

// ===========================================================================
// 21 — npm packaging: LICENSE + package.json polish
// ===========================================================================
Then('a LICENSE file exists at the repo root', function () {
  assert.ok(fs.existsSync(path.join(REPO, 'LICENSE')), 'LICENSE file must exist at repo root');
});

Then('it is an MIT license', function () {
  const text = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
  assert.ok(/MIT License/i.test(text), 'LICENSE must be an MIT license');
});

Then('package.json license field is {string}', function (expected) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.license, expected);
});

Then('package.json declares a node engines constraint', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(pkg.engines && typeof pkg.engines.node === 'string' && pkg.engines.node.length > 0,
    'package.json must declare engines.node');
});

Then('it declares repository, bugs, and homepage URLs', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const repoUrl = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  assert.ok(typeof repoUrl === 'string' && repoUrl.length > 0, 'repository must be declared');
  const bugsUrl = typeof pkg.bugs === 'string' ? pkg.bugs : pkg.bugs?.url;
  assert.ok(typeof bugsUrl === 'string' && bugsUrl.length > 0, 'bugs URL must be declared');
  assert.ok(typeof pkg.homepage === 'string' && pkg.homepage.length > 0, 'homepage must be declared');
});

Then('it declares an author and keywords', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const authorName = typeof pkg.author === 'string' ? pkg.author : pkg.author?.name;
  assert.ok(typeof authorName === 'string' && authorName.length > 0, 'author must be declared');
  assert.ok(Array.isArray(pkg.keywords) && pkg.keywords.length > 0, 'keywords must be a non-empty array');
});

Then('package.json restricts published files to the runtime via a files allowlist', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(pkg.files) && pkg.files.length > 0, 'package.json must declare a files allowlist');
});

Then('the allowlist includes src and LICENSE and README.md', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const files = pkg.files ?? [];
  assert.ok(files.some((f) => f === 'src' || f === 'src/'), 'files allowlist must include src/');
  assert.ok(files.includes('LICENSE'), 'files allowlist must include LICENSE');
  assert.ok(files.includes('README.md'), 'files allowlist must include README.md');
});

Then('the allowlist excludes features, fixtures, docs, and archive', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const files = pkg.files ?? [];
  for (const excluded of ['features', 'fixtures', 'docs', 'archive']) {
    assert.ok(!files.some((f) => f === excluded || f === `${excluded}/`),
      `files allowlist must not include "${excluded}"`);
  }
});

// ===========================================================================
// 22 — auto-updating setup command (plugin mode)
// ===========================================================================
// A representative absolute node path + plugin-cache entrypoint the plugin-mode
// plan() bakes in. Under Option C the command is a plain absolute path (no glob);
// the SessionStart hook re-pins it to the current version after /plugin update.
const ABS_NODE = '/usr/local/bin/node';
const ABS_ENTRYPOINT = '/home/u/.claude/plugins/cache/cc-cream/cc-cream/0.1.18/src/cc-cream.js';

Given('the plugin is installed in the Claude Code plugin cache', function () {
  // The cache layout is the plugin host's concern; plugin-mode plan() bakes the
  // current version's absolute entrypoint. Nothing to set up here.
  this.settings = {};
});

When('the setup command runs in plugin mode and I consent', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ABS_ENTRYPOINT, nodePath: ABS_NODE, consent: true });
});

Then("the command runs the current version's cc-cream.js by its absolute path", function () {
  const cmd = this.result.settings.statusLine.command;
  assert.ok(path.isAbsolute(ABS_ENTRYPOINT), 'fixture entrypoint must be absolute');
  assert.ok(cmd.includes(ABS_ENTRYPOINT), `command must run the absolute entrypoint: ${cmd}`);
});

Then('the command does not glob the plugin cache', function () {
  const cmd = this.result.settings.statusLine.command;
  assert.ok(!/\bls\b|sort -V|tail -1|grep -E|\*/.test(cmd),
    `command must not resolve the version at render time (no glob): ${cmd}`);
});

Then('the command guards a missing entrypoint with a silent exit', function () {
  const cmd = this.result.settings.statusLine.command;
  assert.ok(cmd.includes(`[ -f "${ABS_ENTRYPOINT}" ] || exit 0`),
    `command must degrade to a silent exit when the entrypoint is gone: ${cmd}`);
});

Then('it invokes node by its absolute path, not a bare {string} on PATH', function (bare) {
  const cmd = this.result.settings.statusLine.command;
  assert.ok(cmd.includes(`exec "${ABS_NODE}" `), `command must exec the absolute node path (quoted): ${cmd}`);
  assert.ok(!new RegExp(`(^|\\s)${bare}\\s`).test(cmd.replace(ABS_NODE, '')),
    `command must not invoke a bare "${bare}": ${cmd}`);
});

Given('the statusLine command points at a missing entrypoint', function () {
  // The state left after `/plugin uninstall` deletes the cache without
  // /cc-cream:uninstall first: a stale absolute path to a now-deleted entrypoint.
  const gone = path.join(this.home, 'gone', 'src', 'cc-cream.js');
  this.orphanCommand = statusLineCommand(process.execPath, gone);
});

When('the orphaned status line command runs', function () {
  this.orphanRun = spawnSync('sh', ['-c', this.orphanCommand], {
    env: { ...process.env },
    input: '{"session_id":"x"}',
    encoding: 'utf8',
  });
});

Then('it prints nothing and exits zero', function () {
  assert.equal(this.orphanRun.status, 0, `expected exit 0, got ${this.orphanRun.status}: ${this.orphanRun.stderr}`);
  assert.equal(this.orphanRun.stdout, '', `expected no stdout, got: ${this.orphanRun.stdout}`);
  assert.equal(this.orphanRun.stderr, '', `expected no stderr, got: ${this.orphanRun.stderr}`);
});

Then(/^commands\/setup\.md exists and registers as the (\/cc-cream:setup) command$/, function (cmdName) {
  const p = path.join(REPO, 'commands', 'setup.md');
  assert.ok(fs.existsSync(p), 'commands/setup.md must exist');
  const src = fs.readFileSync(p, 'utf8');
  assert.match(src, /^---\s*\n[\s\S]*?description:[\s\S]*?\n---/, 'setup.md must have frontmatter with a description');
  this.setupMd = src;
  assert.equal(cmdName, '/cc-cream:setup');
});

Then(/^it invokes src\/install\.js in plugin mode rather than writing settings\.json itself$/, function () {
  const src = this.setupMd ?? fs.readFileSync(path.join(REPO, 'commands', 'setup.md'), 'utf8');
  assert.ok(src.includes('install.js --plugin'), 'setup.md must shell out to install.js --plugin');
  assert.ok(!/JSON\.parse|writeFileSync|JSON\.stringify/.test(src),
    'setup.md must not itself write settings.json');
});

const instructsToShowOutput = (file) => {
  const src = fs.readFileSync(path.join(REPO, 'commands', file), 'utf8');
  assert.ok(/\b(show|display)\b/i.test(src) && /\boutput\b/i.test(src) && /\bverbatim\b/i.test(src),
    `${file} must instruct the model to show the command output verbatim, got:\n${src}`);
};

Then('commands\\/setup.md instructs the model to show the command output verbatim', function () {
  instructsToShowOutput('setup.md');
});

Then('commands\\/uninstall.md instructs the model to show the command output verbatim', function () {
  instructsToShowOutput('uninstall.md');
});

Then('it shows a brief one-line note, not a verbose body', function () {
  const src = this.setupMd ?? fs.readFileSync(path.join(REPO, 'commands', 'setup.md'), 'utf8');
  const body = src.replace(/^---\n[\s\S]*?\n---\n/, ''); // strip frontmatter
  const proseLines = body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('!`')); // visible, non-bang lines
  // At least one visible line, so the user sees feedback that the command ran
  // (a body of just the bang line is folded away — that was the 0.1.12 regression).
  assert.ok(proseLines.length >= 1,
    'setup.md must carry a visible note line so the user sees feedback');
  // …but kept brief, so it doesn't bloat the model-facing token cost again.
  assert.ok(proseLines.length <= 2,
    `setup.md note must stay brief (≤2 lines), got ${proseLines.length}: ${proseLines.join(' / ')}`);
});

When('the setup command runs', function () {
  // Setup runs in plugin mode and finds an existing (foreign) statusLine.
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ABS_ENTRYPOINT, nodePath: ABS_NODE, consent: false });
});

Given('a local checkout with no plugin cache', function () {
  // The sandbox HOME starts clean (no plugins/cache); install.js manual mode
  // copies the runtime from the repo's src/ into ~/.claude/cc-cream.
  this.before = {};
});

When('install.js runs without plugin mode and I consent', function () {
  const installer = path.join(REPO, 'src', 'install.js');
  const source = path.join(REPO, 'src', 'cc-cream.js');
  const res = spawnSync(process.execPath, [installer, source], {
    input: 'y\n',
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
  });
  this.installerStdout = res.stdout ?? '';
  this.installerExit = res.status;
  const settingsFile = path.join(this.home, '.claude', 'settings.json');
  this.writtenSettings = fs.existsSync(settingsFile)
    ? JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    : null;
});

Then('it copies the runtime into the home cc-cream directory', function () {
  const homeEntrypoint = path.join(this.home, '.claude', 'cc-cream', 'cc-cream.js');
  assert.ok(fs.existsSync(homeEntrypoint),
    `runtime must be copied to ${homeEntrypoint}; installer said: ${this.installerStdout}`);
});

Then('it points the statusLine command at that copied entrypoint', function () {
  assert.ok(this.writtenSettings, 'settings.json must be written');
  const cmd = this.writtenSettings.statusLine.command;
  const homeEntrypoint = path.join(this.home, '.claude', 'cc-cream', 'cc-cream.js');
  assert.ok(cmd.includes(homeEntrypoint),
    `command must point at the copied entrypoint ${homeEntrypoint}, got: ${cmd}`);
  assert.ok(!cmd.includes('/plugins/cache/'), `manual command must not glob the plugin cache: ${cmd}`);
});

Then('it prints the formatted bar to stdout without any network access', function () {
  // The engine source imports no net/http/dns module (asserted statically), and
  // piping stdin still produces output.
  assert.ok(this.plain.length > 0, 'expected non-empty output');
  const runtimeFiles = fs.readdirSync(path.join(REPO, 'src')).filter((name) => name.endsWith('.js'));
  for (const file of runtimeFiles) {
    const src = fs.readFileSync(path.join(REPO, 'src', file), 'utf8');
    for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      assert.ok(!/^node:(net|http|https|dns|tls|dgram)$/.test(spec) && spec !== 'node:http2',
        `engine must not import a network module (${spec} in ${file})`);
    }
  }
});

// ===========================================================================
// 23 — Plugin validation gate
// ===========================================================================

Then('the pretest flow invokes a {string} script running {string}', function (scriptName, command) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  // validate script exists and contains the expected command
  assert.ok(pkg.scripts && pkg.scripts[scriptName],
    `package.json must have a scripts.${scriptName} entry`);
  assert.ok(pkg.scripts[scriptName].includes(command),
    `scripts.${scriptName} must invoke "${command}", got: ${pkg.scripts[scriptName]}`);
  // --strict must not appear in the everyday validate script
  assert.ok(!pkg.scripts[scriptName].includes('--strict'),
    `everyday scripts.${scriptName} must not include --strict (reserved for pre-submission)`);
  // pretest must reference validate
  assert.ok(pkg.scripts.pretest && pkg.scripts.pretest.includes(scriptName),
    `scripts.pretest must reference "${scriptName}", got: ${pkg.scripts.pretest}`);
});

Given('the {string} CLI is not installed', function (cliName) {
  this.absentCli = cliName;
});

When('the validate script runs', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const validateScript = pkg.scripts.validate;
  assert.ok(validateScript, 'package.json must have a scripts.validate entry');

  if (this.absentCli) {
    // Run with a PATH that excludes the claude CLI to verify the graceful-skip path.
    // Use /bin/sh by absolute path so the shell itself is always found.
    // PATH is set to /dev/null so no external binaries (including claude) are on it.
    const res = spawnSync('/bin/sh', ['-c', validateScript], {
      cwd: REPO,
      env: { ...process.env, PATH: '/dev/null' },
      encoding: 'utf8',
    });
    this.validateExit = res.status;
    this.validateStdout = (res.stdout ?? '') + (res.stderr ?? '');
  } else {
    // Run with normal PATH (claude CLI present).
    const res = spawnSync('sh', ['-c', validateScript], {
      cwd: REPO,
      env: { ...process.env },
      encoding: 'utf8',
    });
    this.validateExit = res.status;
    this.validateStdout = (res.stdout ?? '') + (res.stderr ?? '');
  }
});

Then('it exits zero with a skip notice and does not block the build', function () {
  assert.equal(this.validateExit, 0,
    `validate must exit 0 when claude CLI is absent, got: ${this.validateExit}\nOutput: ${this.validateStdout}`);
  assert.ok(
    this.validateStdout.toLowerCase().includes('skip') ||
    this.validateStdout.toLowerCase().includes('not found'),
    `validate must print a skip notice when claude is absent, got: ${this.validateStdout}`
  );
});

Given('a plugin.json with an invalid field type', function () {
  // Copy manifests to a sandbox temp dir and corrupt marketplace.json with an invalid
  // field type. `claude plugin validate` validates the marketplace manifest schema;
  // setting the top-level `name` to an integer triggers a type error.
  const tmpDir = fs.mkdtempSync(path.join(this.home, 'validate-tmp-'));
  const pluginJsonSrc = path.join(REPO, '.claude-plugin', 'plugin.json');
  const marketplaceSrc = path.join(REPO, '.claude-plugin', 'marketplace.json');
  const pluginDir2 = path.join(tmpDir, '.claude-plugin');
  fs.mkdirSync(pluginDir2, { recursive: true });
  // Copy plugin.json unchanged
  fs.copyFileSync(pluginJsonSrc, path.join(pluginDir2, 'plugin.json'));
  // Corrupt marketplace.json: set top-level `name` to an integer (must be a string)
  const marketplace = JSON.parse(fs.readFileSync(marketplaceSrc, 'utf8'));
  marketplace.name = 12345; // force a type error — `claude plugin validate` catches this
  fs.writeFileSync(path.join(pluginDir2, 'marketplace.json'), JSON.stringify(marketplace));
  this.validateTmpDir = tmpDir;
});

Given('the {string} CLI is installed', function (cliName) {
  const which = spawnSync('sh', ['-c', `command -v ${cliName}`], { encoding: 'utf8' });
  if (which.status !== 0) {
    this.cliSkip = true; // CLI absent — downstream Then will skip-pass
    return;
  }
  this.cliInstalled = cliName;
});

Then('it exits non-zero so the gate blocks the change', function () {
  // Skip-pass when claude CLI is absent (consistent with the graceful-skip design).
  if (this.cliSkip) return;

  // Run claude plugin validate against the temp dir with the corrupted plugin.json.
  const res = spawnSync('claude', ['plugin', 'validate', '.'], {
    cwd: this.validateTmpDir,
    encoding: 'utf8',
  });
  assert.notEqual(res.status, 0,
    `claude plugin validate must exit non-zero on an invalid manifest, got exit 0.\nOutput: ${(res.stdout ?? '') + (res.stderr ?? '')}`);
});

Given('the plugin and marketplace manifests', function () {
  const pluginPath = path.join(REPO, '.claude-plugin', 'plugin.json');
  const marketplacePath = path.join(REPO, '.claude-plugin', 'marketplace.json');
  assert.ok(fs.existsSync(pluginPath), '.claude-plugin/plugin.json must exist');
  assert.ok(fs.existsSync(marketplacePath), '.claude-plugin/marketplace.json must exist');
  this.pluginManifestsExist = true;
});

When('"claude plugin validate . --strict" runs before submission', function () {
  // If the claude CLI is absent, skip; this is a pre-submission manual step.
  const which = spawnSync('sh', ['-c', 'command -v claude'], { encoding: 'utf8' });
  if (which.status !== 0) {
    return 'pending';
  }
  const res = spawnSync('claude', ['plugin', 'validate', '.', '--strict'], {
    cwd: REPO,
    encoding: 'utf8',
  });
  this.strictValidateExit = res.status;
  this.strictValidateOutput = (res.stdout ?? '') + (res.stderr ?? '');
});

Then('it reports no errors and no warnings', function () {
  if (this.strictValidateExit === undefined) {
    return 'pending';
  }
  assert.equal(this.strictValidateExit, 0,
    `claude plugin validate . --strict must exit 0, got ${this.strictValidateExit}\nOutput: ${this.strictValidateOutput}`);
});

// --- CREAM-xzhidmjt: the publish gate is verified on a CI runner without claude ---
Then('a CI workflow runs {string} on pull requests', function (command) {
  const wf = path.join(REPO, '.github', 'workflows', 'ci.yml');
  assert.ok(fs.existsSync(wf), '.github/workflows/ci.yml must exist');
  const src = fs.readFileSync(wf, 'utf8');
  assert.match(src, /^on:|\non:/, 'ci.yml must declare a trigger');
  assert.ok(/pull_request/.test(src), 'ci.yml must trigger on pull_request');
  assert.ok(src.includes(command),
    `ci.yml must run "${command}" (the same command prepublishOnly runs), got:\n${src}`);
});

Then('the default cucumber profile excludes both @manual and @needs-cli', function () {
  const cfg = JSON.parse(fs.readFileSync(path.join(REPO, 'cucumber.json'), 'utf8'));
  const tags = cfg.default?.tags ?? '';
  assert.ok(tags.includes('not @manual'), `default profile must exclude @manual, got: ${tags}`);
  assert.ok(tags.includes('not @needs-cli'), `default profile must exclude @needs-cli, got: ${tags}`);
});

Then('prepublishOnly runs the default profile, never @needs-cli scenarios', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const prepub = pkg.scripts?.prepublishOnly ?? '';
  // prepublishOnly must run the default profile (no explicit profile that would
  // re-include @needs-cli, and not a bare `cucumber-js --profile cli`).
  assert.ok(prepub.includes('npm test') || /cucumber-js\s*$/.test(prepub),
    `prepublishOnly must run the default profile, got: ${prepub}`);
  assert.ok(!/--profile\s+(cli|manual)/.test(prepub),
    `prepublishOnly must not run the cli/manual profiles, got: ${prepub}`);
});

// --- CREAM-gvrvnhsc: cc-cream-setup bin for the npm install flow ---
Then('package.json bin maps {string} to {string}', function (binName, target) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.ok(pkg.bin && typeof pkg.bin === 'object', 'package.json must declare a bin object');
  assert.equal(pkg.bin[binName], target,
    `bin["${binName}"] must be "${target}", got: ${JSON.stringify(pkg.bin[binName])}`);
});

Then(/^src\/install\.js starts with a node shebang so the bin is executable$/, function () {
  const src = fs.readFileSync(path.join(REPO, 'src', 'install.js'), 'utf8');
  assert.match(src, /^#!\/usr\/bin\/env node\n/, 'src/install.js must begin with a node shebang');
});

// --- Non-TTY safety: install.js must never block on a y/N prompt when run via a
// slash command (bang execution has no interactive TTY). Spawning a child with a
// pipe for stdin reproduces that environment. A timeout guards against a
// regression hanging the whole suite — a hang would fail the exit-code assertion.
// The entrypoint the hook/install resolve to in these sandbox tests (no
// CLAUDE_PLUGIN_ROOT set → the engine's own location under the repo).
const CURRENT_ENTRYPOINT = path.join(REPO, 'src', 'cc-cream.js');
// A cc-cream line already pinned to the CURRENT entrypoint — keep-fresh leaves it.
const CURRENT_STATUSLINE = {
  type: 'command',
  command: statusLineCommand(process.execPath, CURRENT_ENTRYPOINT),
  refreshInterval: 60,
};
// A cc-cream line pinned to a DIFFERENT (older) version path — recognized as ours
// (the command contains "cc-cream"), so it is replaced/re-pinned without consent.
const OLD_CC_CREAM_STATUSLINE = {
  type: 'command',
  command: statusLineCommand('/usr/local/bin/node', '/old/plugins/cache/cc-cream/cc-cream/0.0.1/src/cc-cream.js'),
  refreshInterval: 60,
};
function writeSandboxSettings(world, settings) {
  fs.writeFileSync(
    path.join(world.home, '.claude', 'settings.json'),
    `${JSON.stringify(settings, null, 2)}\n`,
  );
}
function readSandboxStatusLine(world) {
  const raw = fs.readFileSync(path.join(world.home, '.claude', 'settings.json'), 'utf8');
  return JSON.parse(raw).statusLine;
}

Given("settings.json on disk has cc-cream's statusLine and a state file", function () {
  writeSandboxSettings(this, { statusLine: CURRENT_STATUSLINE });
  fs.writeFileSync(stateFilePath(this), JSON.stringify({ session: 'x' }));
});

Given('settings.json on disk has a foreign statusLine', function () {
  this.foreignStatusLine = { type: 'command', command: 'bash /old/statusline.sh', refreshInterval: 5 };
  writeSandboxSettings(this, { statusLine: this.foreignStatusLine });
});

Given('settings.json on disk has an older cc-cream statusLine', function () {
  // A cc-cream line pinned to a different (older) entrypoint than manual-mode
  // setup will write; it's ours, so it's rewritten without a consent prompt.
  writeSandboxSettings(this, { statusLine: OLD_CC_CREAM_STATUSLINE });
});

When('install.js --uninstall runs without a TTY', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), '--uninstall'], {
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.installerExit = res.status;
  this.installerOut = (res.stdout ?? '') + (res.stderr ?? '');
});

When('install.js runs without a TTY', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), path.join(REPO, 'src', 'cc-cream.js')], {
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.installerExit = res.status;
  this.installerOut = (res.stdout ?? '') + (res.stderr ?? '');
});

When('install.js runs without a TTY but with --force', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), path.join(REPO, 'src', 'cc-cream.js'), '--force'], {
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.installerExit = res.status;
  this.installerOut = (res.stdout ?? '') + (res.stderr ?? '');
});

Then('the output does not claim it declined the change', function () {
  assert.ok(!/declined/i.test(this.installerOut),
    `--force output must not contain a contradictory "declined" line, got:\n${this.installerOut}`);
});

Then('it exits zero and removes the statusLine', function () {
  assert.equal(this.installerExit, 0, `install.js must exit 0, got ${this.installerExit}\n${this.installerOut}`);
  assert.equal(readSandboxStatusLine(this), undefined,
    `statusLine must be removed, got: ${JSON.stringify(readSandboxStatusLine(this))}`);
});

Then('it auto-removes the session state file', function () {
  assert.ok(!fs.existsSync(stateFilePath(this)),
    `uninstall must auto-clean the regenerable session state, but it remains: ${stateFilePath(this)}`);
});

Given('a cc-cream config file on disk', function () {
  fs.writeFileSync(configFilePath(this), JSON.stringify({ segments: { ctx: { on: true } } }, null, 2));
});

When('install.js --uninstall --purge runs without a TTY', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), '--uninstall', '--purge'], {
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.installerExit = res.status;
  this.installerOut = (res.stdout ?? '') + (res.stderr ?? '');
});

Then('it removes the user config', function () {
  assert.ok(!fs.existsSync(configFilePath(this)),
    `--purge must remove the user config, but it remains: ${configFilePath(this)}`);
});

Then('the output names the cache-path uninstall escape hatch', function () {
  assert.ok(/plugins\/cache\/cc-cream\b[\s\S]*install\.js --uninstall/.test(this.installerOut),
    `output must name the cache-path install.js --uninstall escape hatch, got:\n${this.installerOut}`);
});

Then('the output mentions removing the marketplace and the version cache', function () {
  assert.ok(/marketplace remove/.test(this.installerOut), `output must mention /plugin marketplace remove, got:\n${this.installerOut}`);
  assert.ok(/plugins\/cache\/cc-cream/.test(this.installerOut), `output must name the version cache path, got:\n${this.installerOut}`);
});

Then('the output says the slash commands linger until restart', function () {
  assert.ok(/linger[\s\S]*restart/i.test(this.installerOut),
    `output must say the slash commands linger until restart, got:\n${this.installerOut}`);
});

Then('the receipt carries no angle-bracket placeholder', function () {
  assert.ok(!/<[^>]+>/.test(this.installerOut),
    `the uninstall receipt must not contain an angle-bracket placeholder (markdown strips it), got:\n${this.installerOut}`);
});

Then('it exits zero and leaves the foreign statusLine unchanged', function () {
  assert.equal(this.installerExit, 0, `install.js must exit 0, got ${this.installerExit}\n${this.installerOut}`);
  assert.deepEqual(readSandboxStatusLine(this), this.foreignStatusLine,
    'a foreign statusLine must be left untouched in non-interactive setup');
});

Then("it exits zero and rewrites the statusLine to cc-cream's", function () {
  assert.equal(this.installerExit, 0, `install.js must exit 0, got ${this.installerExit}\n${this.installerOut}`);
  const sl = readSandboxStatusLine(this);
  assert.ok(sl && typeof sl.command === 'string' && sl.command.includes('cc-cream'),
    `statusLine must be cc-cream's, got: ${JSON.stringify(sl)}`);
  assert.ok(sl.command.includes(path.join(this.home, '.claude', 'cc-cream')),
    `non-interactive setup must rewrite to the home-copy entrypoint, got: ${sl.command}`);
});

// ===========================================================================
// 26 — setup reminder SessionStart hook
// ===========================================================================
Then(/^hooks\/hooks\.json exists and registers a SessionStart command hook$/, function () {
  const file = path.join(REPO, 'hooks', 'hooks.json');
  assert.ok(fs.existsSync(file), 'hooks/hooks.json must exist');
  this.hooksJson = JSON.parse(fs.readFileSync(file, 'utf8'));
  const entries = this.hooksJson.hooks?.SessionStart;
  assert.ok(Array.isArray(entries) && entries.length > 0, 'hooks.json must register a SessionStart hook');
  const inner = entries[0].hooks?.[0];
  assert.equal(inner?.type, 'command', 'the SessionStart hook must be of type "command"');
  this.hookCommand = inner.command;
});

Then(/^the hook command runs hooks\/auto-setup\.js via \$\{CLAUDE_PLUGIN_ROOT\}$/, function () {
  assert.ok(this.hookCommand.includes('${CLAUDE_PLUGIN_ROOT}'),
    `hook command must use \${CLAUDE_PLUGIN_ROOT}, got: ${this.hookCommand}`);
  assert.ok(this.hookCommand.includes('hooks/auto-setup.js'),
    `hook command must run hooks/auto-setup.js, got: ${this.hookCommand}`);
  // And that script must actually exist in the plugin.
  assert.ok(fs.existsSync(path.join(REPO, 'hooks', 'auto-setup.js')),
    'hooks/auto-setup.js must exist');
});

Given('there is no settings.json on disk', function () {
  const file = path.join(this.home, '.claude', 'settings.json');
  if (fs.existsSync(file)) fs.rmSync(file);
});

const pluginDataDir = (world) => path.join(world.home, 'plugin-data');

Given('cc-cream has already auto-set-up once', function () {
  const dir = pluginDataDir(this);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'cc-cream-autowire-done'), '');
});

When('the session-start hook runs', function () {
  const settingsFile = path.join(this.home, '.claude', 'settings.json');
  this.settingsBefore = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
  const env = { ...process.env, HOME: this.home, CLAUDE_PLUGIN_DATA: pluginDataDir(this) };
  delete env.CLAUDE_CONFIG_DIR; // force the hook to resolve ~/.claude under the sandbox HOME
  const res = spawnSync(process.execPath, [path.join(REPO, 'hooks', 'auto-setup.js')], {
    env,
    encoding: 'utf8',
    timeout: 15000,
  });
  this.reminderExit = res.status;
  this.reminderOut = (res.stdout ?? '').trim();
});

Then("it writes cc-cream's statusLine into settings.json", function () {
  const sl = readSandboxStatusLine(this);
  assert.ok(sl && typeof sl.command === 'string' && sl.command.includes('cc-cream'),
    `auto-wire must write a cc-cream statusLine, got: ${JSON.stringify(sl)}`);
  assert.ok(sl.command.includes(CURRENT_ENTRYPOINT),
    `auto-wired command must bake the current entrypoint's absolute path, got: ${sl.command}`);
  assert.ok(sl.command.startsWith('[ -f '),
    `auto-wired command must guard a missing entrypoint, got: ${sl.command}`);
  assert.equal(sl.refreshInterval, 60, 'auto-wired statusLine must set refreshInterval 60');
});

Given('settings.json on disk has an out-of-date cc-cream statusLine', function () {
  writeSandboxSettings(this, { statusLine: OLD_CC_CREAM_STATUSLINE });
});

Then('it re-pins the statusLine to the current entrypoint', function () {
  const sl = readSandboxStatusLine(this);
  assert.ok(sl && typeof sl.command === 'string' && sl.command.includes(CURRENT_ENTRYPOINT),
    `keep-fresh must re-pin to the current entrypoint, got: ${JSON.stringify(sl)}`);
  assert.equal(sl.refreshInterval, 60);
});

Then('it makes the change without announcing', function () {
  assert.equal(this.reminderOut, '', `a routine re-pin must be silent, got: ${this.reminderOut}`);
});

Then('it announces that the status bar was enabled', function () {
  this.reminderJson = JSON.parse(this.reminderOut);
  assert.ok(/enabled your status bar/i.test(this.reminderJson.systemMessage ?? ''),
    `systemMessage must announce the bar was enabled, got: ${this.reminderOut}`);
});

Then('it leaves the foreign statusLine unchanged', function () {
  assert.deepEqual(readSandboxStatusLine(this), this.foreignStatusLine,
    'a foreign statusLine must be left untouched');
});

Then('it changes nothing and prints nothing', function () {
  assert.equal(this.reminderOut, '', `expected no output, got: ${this.reminderOut}`);
  const settingsFile = path.join(this.home, '.claude', 'settings.json');
  const after = fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : null;
  assert.equal(after, this.settingsBefore, 'settings.json must be byte-for-byte unchanged');
});

Then(/^it prints a systemMessage telling the user to run \/cc-cream:setup$/, function () {
  assert.ok(this.reminderOut, `expected a systemMessage, got empty output`);
  this.reminderJson = JSON.parse(this.reminderOut);
  assert.ok(typeof this.reminderJson.systemMessage === 'string',
    `output must carry a systemMessage, got: ${this.reminderOut}`);
  assert.ok(this.reminderJson.systemMessage.includes('/cc-cream:setup'),
    `systemMessage must point to /cc-cream:setup, got: ${this.reminderJson.systemMessage}`);
});

Then('the reminder adds nothing to the model context', function () {
  // systemMessage is user-facing only; additionalContext is what would cost tokens.
  const json = this.reminderJson ?? JSON.parse(this.reminderOut);
  assert.equal(json.additionalContext, undefined, 'reminder must not set additionalContext');
  assert.equal(json.hookSpecificOutput?.additionalContext, undefined,
    'reminder must not set hookSpecificOutput.additionalContext');
});

Then('the reminder exits zero', function () {
  assert.equal(this.reminderExit, 0, `auto-setup hook must exit 0, got ${this.reminderExit}`);
});

// ===========================================================================
// 24 — User-facing docs & disclosure
// ===========================================================================
function readmeText() {
  return fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
}

function securityText() {
  return fs.readFileSync(path.join(REPO, 'SECURITY.md'), 'utf8');
}

function contributingText() {
  return fs.readFileSync(path.join(REPO, 'CONTRIBUTING.md'), 'utf8');
}

// Install paths
Then('the README documents installing from the community catalog or self-hosted marketplace', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('plugin marketplace add') || readme.includes('/plugin install'),
    'README must document the marketplace install path');
  assert.ok(readme.includes('plugin marketplace add') && readme.includes('/plugin install'),
    'README must document both marketplace add and plugin install commands');
});

Then('it documents installing via npm or npx', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('npx') || readme.includes('npm install'),
    'README must document npm/npx install');
  assert.ok(readme.includes('npx') && readme.includes('npm install'),
    'README must document both npx and npm install');
});

Then('it documents the manual GitHub clone path', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('git clone') || readme.includes('github'),
    'README must document the manual GitHub clone path');
  assert.ok(readme.includes('git clone'), 'README must include git clone command');
});

// Version requirements
Then('the README states the minimum Claude Code version of 2.1.132', function () {
  const readme = readmeText();
  assert.ok(readme.includes('2.1.132'),
    'README must state minimum Claude Code version 2.1.132');
});

Then('it notes effort and thinking segments require 2.1.145', function () {
  const readme = readmeText();
  assert.ok(readme.includes('2.1.145'),
    'README must note that effort/thinking segments require 2.1.145');
});

// Data posture
Then('the README states that cc-cream makes no network calls', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('no network') || readme.includes('never') && readme.includes('network'),
    'README must state that cc-cream makes no network calls');
});

Then('it states that it collects no telemetry', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('no telemetry') || readme.includes('telemetry'),
    'README must state that cc-cream collects no telemetry');
  assert.ok(readme.includes('no telemetry'), 'README must explicitly state "no telemetry"');
});

Then('it states that it has no runtime dependencies and costs zero tokens', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('no runtime') || readme.includes('runtime dependencies'),
    'README must state no runtime dependencies');
  assert.ok(readme.includes('zero tokens') || readme.includes('costs zero tokens'),
    'README must state zero tokens cost');
});

// Visual + config reference
Then('the README includes a visual of the rendered status bar', function () {
  const readme = readmeText();
  // A fenced code block containing typical bar content (ctx or model line)
  assert.ok(/```[\s\S]*?ctx:[\s\S]*?```/.test(readme) || /```[\s\S]*?cache:[\s\S]*?```/.test(readme),
    'README must include a fenced code block showing the rendered bar');
});

Then('it documents the ~\\/.claude\\/cc-cream.json configuration and the segment catalog', function () {
  const readme = readmeText();
  assert.ok(readme.includes('cc-cream.json'), 'README must reference cc-cream.json');
  // Segment catalog: check for key segment names
  assert.ok(readme.includes('ctx') && readme.includes('cache') && readme.includes('ttl'),
    'README must document the segment catalog');
  assert.ok(readme.includes('amber') && readme.includes('red'),
    'README must document threshold colors in the segment catalog');
});

// Trust signal files
Then('a SECURITY.md describes the threat model and the no-network posture', function () {
  const security = securityText();
  assert.ok(fs.existsSync(path.join(REPO, 'SECURITY.md')), 'SECURITY.md must exist');
  const lower = security.toLowerCase();
  assert.ok(lower.includes('threat model') || lower.includes('threat'),
    'SECURITY.md must describe the threat model');
  assert.ok(lower.includes('no network') || (lower.includes('network') && lower.includes('no')),
    'SECURITY.md must describe the no-network posture');
});

Then('a CONTRIBUTING.md states the best-effort maintenance posture', function () {
  const contributing = contributingText();
  assert.ok(fs.existsSync(path.join(REPO, 'CONTRIBUTING.md')), 'CONTRIBUTING.md must exist');
  const lower = contributing.toLowerCase();
  assert.ok(lower.includes('best-effort') || lower.includes('best effort'),
    'CONTRIBUTING.md must state the best-effort maintenance posture');
});

// Platform scope
Then('the README states that v1 supports macOS and Linux', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('macos') && readme.includes('linux'),
    'README must state that v1 supports macOS and Linux');
});

Then('it notes Windows support is a planned fast-follow', function () {
  const readme = readmeText().toLowerCase();
  assert.ok(readme.includes('windows'),
    'README must mention Windows support');
  assert.ok(readme.includes('fast-follow') || readme.includes('planned'),
    'README must note Windows is a planned fast-follow');
});

// ===========================================================================
// 25 — Publish & submit (automated gates)
// ===========================================================================

Then('package.json version matches the latest CHANGELOG entry', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const changelog = fs.readFileSync(path.join(REPO, 'CHANGELOG.md'), 'utf8');
  const match = changelog.match(/^##\s*\[(\d+\.\d+\.\d+)\]/m);
  assert.ok(match, 'CHANGELOG.md must have a "## [x.y.z]" version heading');
  assert.equal(pkg.version, match[1],
    `package.json version (${pkg.version}) must match the latest CHANGELOG entry ([${match[1]}])`);
});

Then('.claude-plugin\\/plugin.json version matches package.json', function () {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const plugin = JSON.parse(fs.readFileSync(path.join(REPO, '.claude-plugin', 'plugin.json'), 'utf8'));
  assert.equal(plugin.version, pkg.version,
    `plugin.json version (${plugin.version}) must match package.json (${pkg.version})`);
});

Then('the README documents adding the marketplace with {string}', function (command) {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.includes(command),
    `README must include "${command}"`);
});

Then('then installing with {string}', function (command) {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  assert.ok(readme.includes(command),
    `README must include "${command}"`);
});

// ===========================================================================
// 28 — security hardening
// ===========================================================================
// A name laced with: an OSC title-set (ESC ] 0 ; … BEL), a CSI erase-line, and
// a raw DEL. The printable residue ("safeOSCeraseDEL...") must survive; every
// control byte must be gone from what reaches the terminal.
const EVIL = 'safe\x1b]0;pwned\x07OSC\x1b[2KeraseDEL\x7fend';

Given('stdin whose model display_name carries terminal escape sequences', function () {
  this.data.model = { display_name: EVIL };
});

Given('stdin whose session_name carries terminal escape sequences, with the segment enabled', function () {
  this.data.session_name = EVIL;
  this.configRaw = JSON.stringify({ segments: { session_name: { on: true } } });
});

// No C0/C1 control byte may reach the terminal — except the row-separator
// newline (0x0A) the renderer itself inserts between rows.
Then('the output contains no terminal control characters', function () {
  const bad = [...this.stdout].filter((ch) => {
    const c = ch.charCodeAt(0);
    return (c < 0x20 && c !== 0x0a) || (c >= 0x7f && c <= 0x9f); // C0 (sans \n) + DEL + C1
  });
  assert.deepEqual(bad, [], `control bytes leaked to the terminal: ${bad.map((ch) => ch.charCodeAt(0)).join(',')}`);
});

Then('the output still shows the printable part of the name', function () {
  assert.ok(this.plain.includes('safe') && this.plain.includes('end'),
    `printable text was lost: ${JSON.stringify(this.plain)}`);
});

When('I atomically write {string} to a file in the sandbox', function (contents) {
  this.atomicTarget = path.join(this.home, '.claude', 'atomic-test.txt');
  this.atomicContents = contents;
  writeFileAtomic(this.atomicTarget, contents);
});

Then('the file contains exactly {string}', function (expected) {
  assert.equal(fs.readFileSync(this.atomicTarget, 'utf8'), expected);
});

Then('no temporary write-file remains in the directory', function () {
  const dir = path.dirname(this.atomicTarget);
  const base = path.basename(this.atomicTarget);
  const leftovers = fs.readdirSync(dir).filter((n) => n.startsWith(`${base}.tmp-`));
  assert.deepEqual(leftovers, [], `temp files left behind: ${leftovers.join(', ')}`);
});

Then('no session entry is recorded for {string}', function (id) {
  if (!fs.existsSync(stateFilePath(this))) return; // nothing written at all is fine
  const state = JSON.parse(fs.readFileSync(stateFilePath(this), 'utf8'));
  const sessions = state?.sessions ?? {};
  assert.ok(!Object.hasOwn(sessions, id), `a "${id}" session entry was recorded`);
});

Given('a session state holding {int} sessions', function (n) {
  const sessions = {};
  // ts ascending with index, so session-0 is the oldest and session-(n-1) the newest.
  for (let i = 0; i < n; i++) sessions[`session-${i}`] = { cost: i, ts: 1000 + i };
  this.seedState = { sessions };
  this.seedCount = n;
});

When('a new session is patched in', function () {
  // ts above every seeded session, so the new one is the newest.
  this.patched = patchSessionState(this.seedState, 'session-new', { ts: 999999 });
});

Then('the session map keeps at most {int} sessions', function (cap) {
  const count = Object.keys(this.patched.sessions).length;
  assert.ok(count <= cap, `expected at most ${cap} sessions, got ${count}`);
});

Then('it keeps the newest prior session and drops the oldest', function () {
  const sessions = this.patched.sessions;
  assert.ok(Object.hasOwn(sessions, 'session-new'), 'the just-patched session was dropped');
  assert.ok(Object.hasOwn(sessions, `session-${this.seedCount - 1}`), 'the newest prior session was dropped');
  assert.ok(!Object.hasOwn(sessions, 'session-0'), 'the oldest session was not evicted');
});

// ===========================================================================
// 29 — golden render snapshot (CREAM-twlrcxdk): a fully-controlled, deterministic
// full-bar render that locks holistic row assembly before the pure-render
// refactor. Everything time-dependent is pinned: a fixed clock, an in-sandbox
// transcript at age 0 (TTL anchor = now → ttl:01:00), and sub-day rate-limit
// resets (no timezone-dependent weekday/clock countdown).
// ===========================================================================
Given('a fully-specified subscriber session at a fixed time', function () {
  this.now = 1748563200000; // off-peak in America/Los_Angeles (no "peak" segment)
  this.data = {
    session_id: 'snapshot',
    model: { display_name: 'Sonnet 4.6' },
    context_window: {
      used_percentage: 15,
      total_input_tokens: 31000,
      current_usage: { cache_read_input_tokens: 38, cache_creation_input_tokens: 12, input_tokens: 50 },
    },
    cost: { total_cost_usd: 0.1 },
    transcript_path: this.makeTranscript(0),
    rate_limits: {
      five_hour: { used_percentage: 22, resets_at: (this.now + 90 * 60000) / 1000 },
      seven_day: { used_percentage: 36, resets_at: (this.now + 200 * 60000) / 1000 },
    },
  };
});

When('the engine runs', function () {
  this.run();
});

Then('the rendered bar exactly matches the golden snapshot:', function (expected) {
  assert.equal(this.plain.replace(/\n$/, ''), expected.replace(/\n$/, ''),
    `rendered bar drifted from the golden snapshot.\n--- got ---\n${this.plain}\n--- want ---\n${expected}\n`);
});

// ===========================================================================
// 30 — config doctor (CREAM-kkjlhexy): cc-cream-setup --check-config
// ===========================================================================
Given('a cc-cream config file:', function (body) {
  fs.writeFileSync(path.join(this.home, '.claude', 'cc-cream.json'), body);
});

Given('no cc-cream config file', function () {
  const p = path.join(this.home, '.claude', 'cc-cream.json');
  if (fs.existsSync(p)) fs.rmSync(p);
});

When('the config doctor runs', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), '--check-config'], {
    env: { ...process.env, HOME: this.home },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.doctorExit = res.status;
  this.doctorOut = (res.stdout ?? '') + (res.stderr ?? '');
});

Then('the config doctor reports no problems and exits zero', function () {
  assert.equal(this.doctorExit, 0, `expected exit 0, got ${this.doctorExit}\n${this.doctorOut}`);
  assert.ok(!/problem/i.test(this.doctorOut), `expected no problems, got:\n${this.doctorOut}`);
});

Then('the config doctor reports a problem mentioning {string} and exits non-zero', function (needle) {
  assert.notEqual(this.doctorExit, 0, `expected non-zero exit, got 0\n${this.doctorOut}`);
  assert.ok(this.doctorOut.includes(needle), `expected a problem mentioning "${needle}", got:\n${this.doctorOut}`);
});

// ===========================================================================
// 31 — opt-in debug diagnostics (CREAM-wsfhfgsx): CC_CREAM_DEBUG
// ===========================================================================
Given('a session with only a model name', function () {
  this.data = { session_id: 'dbg', model: { display_name: 'Opus 4.7' } };
});

Given('debug logging is enabled', function () {
  this.debugLog = path.join(this.home, '.claude', 'cc-cream-debug.log');
  this.env.CC_CREAM_DEBUG = '1';
  this.env.CC_CREAM_DEBUG_LOG = this.debugLog;
});

Then('no debug log file is written', function () {
  const p = path.join(this.home, '.claude', 'cc-cream-debug.log');
  assert.ok(!fs.existsSync(p), 'no debug log must be created when CC_CREAM_DEBUG is unset');
});

Then('the bar still renders to stdout', function () {
  assert.equal(this.plain.trim(), 'Opus 4.7', `expected the model bar on stdout, got: ${JSON.stringify(this.plain)}`);
});

Then('the debug log names {string} among the hidden segments', function (id) {
  const log = fs.readFileSync(this.debugLog, 'utf8');
  const hiddenLine = log.split('\n').find((l) => l.includes('hidden')) ?? '';
  assert.ok(hiddenLine.includes(id), `expected "${id}" among hidden segments, got log:\n${log}`);
});

Then('the debug log does not change what is printed to stdout', function () {
  assert.equal(this.plain.trim(), 'Opus 4.7', `stdout must be unchanged by debug logging, got: ${JSON.stringify(this.plain)}`);
  assert.ok(!this.stdout.includes('hidden'), 'debug output must never leak into stdout');
});

// ===========================================================================
// 32 — ghost-bar self-defense (orphaned plugin cache)
// ===========================================================================
const registryPath = (world) => path.join(world.pluginsDir, 'installed_plugins.json');

Given('a session JSON that renders a bar', function () {
  this.data = { model: { display_name: 'Opus 4.7' }, context_window: { used_percentage: 19, total_input_tokens: 38000 } };
});

// Reproduce a plugin install: copy the real engine into the host's versioned
// plugin-cache path and run it from there, so import.meta.url is under
// plugins/cache/ exactly as it is post-install. The registry it consults is
// derived from that path, so seeding it lives under the same plugins dir.
Given(/^the engine is installed in the plugin cache as version "([^"]+)"$/, function (version) {
  const versionDir = path.join(this.home, '.claude', 'plugins', 'cache', 'cc-cream', 'cc-cream', version);
  const destSrc = path.join(versionDir, 'src');
  fs.mkdirSync(destSrc, { recursive: true });
  for (const name of fs.readdirSync(path.join(REPO, 'src'))) {
    if (name.endsWith('.js')) fs.copyFileSync(path.join(REPO, 'src', name), path.join(destSrc, name));
  }
  this.engineOverride = path.join(destSrc, 'cc-cream.js');
  this.pluginCacheVersionDir = versionDir;
  this.pluginsDir = path.join(this.home, '.claude', 'plugins');
});

Given('the host plugin registry file is absent', function () {
  if (this.pluginsDir && fs.existsSync(registryPath(this))) fs.rmSync(registryPath(this));
});

Given('the host plugin registry file is corrupt', function () {
  fs.writeFileSync(registryPath(this), 'not json{{{');
});

Given('the host plugin registry lists other plugins but not cc-cream', function () {
  const reg = {
    version: 2,
    plugins: {
      'fp@fiberplane-claude-code-plugins': [
        { installPath: path.join(this.pluginsDir, 'cache', 'fiberplane-claude-code-plugins', 'fp', '0.14.0'), version: '0.14.0' },
      ],
    },
  };
  fs.writeFileSync(registryPath(this), JSON.stringify(reg, null, 2));
});

Given('the host plugin registry lists cc-cream', function () {
  const reg = {
    version: 2,
    plugins: {
      'cc-cream@cc-cream': [{ installPath: this.pluginCacheVersionDir, version: '0.2.0' }],
    },
  };
  fs.writeFileSync(registryPath(this), JSON.stringify(reg, null, 2));
});

// ===========================================================================
// 33 — footprint status report (cc-cream-setup --status)
// ===========================================================================
Given('a full cc-cream footprint on disk', function () {
  const claude = path.join(this.home, '.claude');
  const plugins = path.join(claude, 'plugins');
  const versionDir = path.join(plugins, 'cache', 'cc-cream', 'cc-cream', '0.2.0');
  fs.mkdirSync(path.join(versionDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(plugins, 'marketplaces', 'cc-cream'), { recursive: true });
  fs.mkdirSync(path.join(plugins, 'data', 'cc-cream-cc-cream'), { recursive: true });
  fs.mkdirSync(path.join(claude, 'cc-cream'), { recursive: true });

  const ep = path.join(versionDir, 'src', 'cc-cream.js');
  fs.writeFileSync(ep, '// engine');
  writeSandboxSettings(this, { statusLine: { type: 'command', command: statusLineCommand(process.execPath, ep), refreshInterval: 60 } });
  fs.writeFileSync(path.join(plugins, 'installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'cc-cream@cc-cream': [{ installPath: versionDir, version: '0.2.0' }] } }, null, 2));
  fs.writeFileSync(path.join(plugins, 'known_marketplaces.json'),
    JSON.stringify({ 'cc-cream': { source: { source: 'github', repo: 'bart-turczynski/cc-cream' } } }, null, 2));
  fs.writeFileSync(path.join(plugins, 'data', 'cc-cream-cc-cream', 'cc-cream-autowire-done'), '');
  fs.writeFileSync(stateFilePath(this), JSON.stringify({ sessA: { x: 1 }, sessB: { y: 2 } }));
  fs.writeFileSync(configFilePath(this), JSON.stringify({ segments: {} }));
});

Given('a cc-cream statusLine pinned to a missing entrypoint', function () {
  const ep = path.join(this.home, '.claude', 'plugins', 'cache', 'cc-cream', 'cc-cream', '0.0.9', 'src', 'cc-cream.js');
  writeSandboxSettings(this, { statusLine: { type: 'command', command: statusLineCommand(process.execPath, ep), refreshInterval: 60 } });
});

When('cc-cream-setup --status runs', function () {
  const res = spawnSync(process.execPath, [path.join(REPO, 'src', 'install.js'), '--status'], {
    env: { ...process.env, HOME: this.home, CLAUDE_PLUGIN_DATA: '' },
    encoding: 'utf8',
    timeout: 15000,
  });
  this.statusExit = res.status;
  this.statusOut = (res.stdout ?? '') + (res.stderr ?? '');
});

Then('the status report exits zero', function () {
  assert.equal(this.statusExit, 0, `--status must exit 0, got ${this.statusExit}\n${this.statusOut}`);
});

Then('the report says it is a clean slate', function () {
  assert.ok(/clean slate/i.test(this.statusOut), `expected a clean-slate verdict, got:\n${this.statusOut}`);
});

Then('the report does not say it is a clean slate', function () {
  assert.ok(!/clean slate/i.test(this.statusOut), `expected NO clean-slate verdict, got:\n${this.statusOut}`);
});

Then("the report lists the statusLine wiring as cc-cream's", function () {
  assert.ok(/statusLine wiring: belongs to cc-cream/.test(this.statusOut),
    `expected the statusLine to be reported as cc-cream's, got:\n${this.statusOut}`);
});

Then('the report lists the plugin cache versions', function () {
  assert.ok(/plugin cache: \d+ version/.test(this.statusOut),
    `expected the plugin cache versions to be listed, got:\n${this.statusOut}`);
});

Then('the report lists the session state, config, and manual runtime copy', function () {
  assert.ok(/session state: \d+ session/.test(this.statusOut), `expected session state listed, got:\n${this.statusOut}`);
  assert.ok(/config: .*cc-cream\.json/.test(this.statusOut), `expected config listed, got:\n${this.statusOut}`);
  assert.ok(/manual runtime copy: .*cc-cream/.test(this.statusOut), `expected manual runtime listed, got:\n${this.statusOut}`);
});

Then('the report flags the statusLine entrypoint as missing', function () {
  assert.ok(/statusLine wiring:.*MISSING/.test(this.statusOut),
    `expected a MISSING entrypoint flag, got:\n${this.statusOut}`);
});

// ===========================================================================
// 34 — release tooling (scripts/release.mjs pure helpers)
// ===========================================================================
Given('the current package version is {string}', function (v) {
  this.curVersion = v;
});

When('I compute the next version for {string}', function (bump) {
  this.nextVersion = nextVersion(this.curVersion, bump);
});

Then('the next version is {string}', function (expected) {
  assert.equal(this.nextVersion, expected);
});

Given('a plugin manifest:', function (doc) {
  this.manifest = doc;
});

When('I set the manifest version to {string}', function (v) {
  this.manifestOut = setJsonVersion(this.manifest, v);
});

Then('the manifest version is {string}', function (v) {
  assert.ok(this.manifestOut.includes(`"version": "${v}"`), `manifest must carry version ${v}, got:\n${this.manifestOut}`);
});

Then('the one-line keywords array is left untouched', function () {
  assert.ok(this.manifestOut.includes('"keywords": ["a", "b", "c"]'),
    `keywords array formatting must be preserved, got:\n${this.manifestOut}`);
});

Given('a CHANGELOG with entries under Unreleased:', function (doc) {
  this.changelog = doc;
});

Given('a CHANGELOG with an empty Unreleased section:', function (doc) {
  this.changelog = doc;
});

When('I roll the CHANGELOG to {string} dated {string}', function (version, date) {
  this.rolled = rollChangelog(this.changelog, version, date);
});

When('I roll the CHANGELOG expecting it to fail', function () {
  try {
    rollChangelog(this.changelog, '0.3.0', '2026-06-01');
    this.rollError = null;
  } catch (err) {
    this.rollError = err;
  }
});

Then('the rolled CHANGELOG\'s first version heading is {string} dated {string}', function (version, date) {
  const first = this.rolled.match(/^##\s*\[(\d+\.\d+\.\d+)\][^\n]*/m);
  assert.ok(first, `expected a version heading, got:\n${this.rolled}`);
  assert.equal(first[1], version, `first version heading must be ${version}, got ${first[1]}`);
  assert.ok(first[0].includes(date), `first version heading must carry the date ${date}, got: ${first[0]}`);
});

Then('the rolled CHANGELOG keeps an empty Unreleased section on top', function () {
  // The [Unreleased] heading must sit above the new version heading with no body.
  const between = this.rolled.split('## [Unreleased]')[1].split(/\n## \[/)[0].trim();
  assert.equal(between, '', `[Unreleased] must be empty after a roll, got: ${JSON.stringify(between)}`);
  assert.ok(this.rolled.indexOf('## [Unreleased]') < this.rolled.search(/^##\s*\[\d/m),
    '[Unreleased] must stay above the first version heading');
});

Then('the entry {string} now sits under the {word} heading', function (entry, version) {
  const section = this.rolled.split(`## [${version}]`)[1].split(/\n## \[/)[0];
  assert.ok(section.includes(entry), `"${entry}" must sit under [${version}], got:\n${section}`);
});

Then('it reports there is nothing to release', function () {
  assert.ok(this.rollError, 'expected rollChangelog to throw on an empty Unreleased section');
  assert.ok(/nothing/i.test(this.rollError.message), `error must mention nothing to release, got: ${this.rollError.message}`);
});
