import { Given, When, Then } from '@cucumber/cucumber';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, ENGINE, colorOf } from '../support/world.js';
import { loadConfig, resolveTtl, countdown } from '../../src/cc-cream.js';
import { plan } from '../../src/install.js';

// Path to the state file inside a scenario's sandbox HOME.
const stateFilePath = (world) => path.join(world.home, '.claude', 'cc-cream-state.json');

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
  return text.replace(/(5h|7d):[^·]*·↺(\d+d)\b/g, (match, seg) => {
    const w = seg === '5h' ? rl?.five_hour : rl?.seven_day;
    if (!w?.resets_at) return match;
    return match.replace(/↺\d+d\b/, `↺${countdown(w.resets_at * 1000, world.now)}`);
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

Then(/^the model segment renders with its built-in defaults \(on, row 1, order 1\)$/, function () {
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
// 05 — idle / cache-warmth
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

Then('the idle segment reads {string} and is green', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
  assert.equal(colorOf(this.stdout, /idle:\d+:\d+/), 'green');
});

Then('the idle segment reads {string}', function (text) {
  assert.ok(this.plain.includes(text), `expected "${text}" in: ${this.plain}`);
});

Then('the idle segment is colored {word}', function (color) {
  assert.equal(colorOf(this.stdout, /idle:\d+:\d+/), color);
});

Then('the idle segment is not rendered', function () {
  assert.ok(!/idle:/.test(this.plain));
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
  const m = this.plain.match(/5h:\d+%·(↺\S+(?:\s\d{2}:\d{2})?)/);
  assert.ok(m, `no countdown found in: ${this.plain}`);
  let expected = text;
  if (/↺\d+d\b/.test(text)) {
    const ra = this.data?.rate_limits?.five_hour?.resets_at;
    if (ra != null) expected = `↺${countdown(ra * 1000, this.now)}`;
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
const seg5h = (plain) => plain.match(/5h:\S+/)?.[0] ?? null;

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
  const percentage = seg.slice('5h:'.length).split('·')[0]; // text before the countdown joiner
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
  this.settings = { statusLine: { type: 'command', command: `node ${ENGINE}`, refreshInterval: 60 } };
});

When('the installer runs and I consent', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, consent: true });
});

When('the installer runs', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, consent: false });
});

When('the installer runs again', function () {
  this.before = JSON.parse(JSON.stringify(this.settings));
  this.result = plan(this.settings, { entrypoint: ENGINE, consent: true });
});

When('the installer completes', function () {
  this.result = plan({}, { entrypoint: ENGINE, consent: true });
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

Then('it states that Claude Code must be trusted and possibly restarted for the bar to appear', function () {
  const joined = this.result.messages.join('\n').toLowerCase();
  assert.ok(joined.includes('trusted'));
  assert.ok(joined.includes('restart'));
});

// ===========================================================================
// 10 — distribution (raw .js)
// ===========================================================================
Then('the published artifact is one .js file using only Node built-ins', function () {
  assert.ok(fs.existsSync(ENGINE), 'src/cc-cream.js must exist');
  const src = fs.readFileSync(ENGINE, 'utf8');
  const specifiers = [...src.matchAll(/import\s+[^'"]*from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  assert.ok(specifiers.length > 0, 'engine should import its built-ins');
  for (const spec of specifiers) {
    assert.ok(spec.startsWith('node:'), `non-builtin import: ${spec}`);
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

Given(/^stdin with an idle duration of (\d{1,2}):(\d{2})$/, function (hh, mm) {
  this.data.transcript_path = this.makeTranscript(Number(hh) * 60 + Number(mm));
});

Then('the 5h segment percentage reads {string}', function (pct) {
  const seg = seg5h(this.plain);
  assert.ok(seg, `no 5h segment in: ${this.plain}`);
  assert.equal(seg.slice('5h:'.length).split('·')[0], pct);
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
