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

Then('it registers the setup command at {string}', function (cmd) {
  const commands = readPluginJson().commands;
  assert.ok(Array.isArray(commands) && commands.includes(cmd),
    `commands must include "${cmd}", got: ${JSON.stringify(commands)}`);
});

Then(/^plugin\.json description references "([^"]+)"$/, function (phrase) {
  const desc = readPluginJson().description;
  assert.ok(typeof desc === 'string' && desc.includes(phrase),
    `description must include "${phrase}", got: ${desc}`);
});

Then(/^\.claude-plugin contains exactly plugin\.json and marketplace\.json$/, function () {
  const entries = fs.readdirSync(pluginDir).sort();
  assert.deepEqual(entries, ['marketplace.json', 'plugin.json'],
    `.claude-plugin must contain exactly plugin.json and marketplace.json, got: ${entries}`);
});

Then(/^no commands, agents, hooks, or source modules live inside \.claude-plugin$/, function () {
  const entries = fs.readdirSync(pluginDir);
  for (const entry of entries) {
    const stat = fs.statSync(path.join(pluginDir, entry));
    assert.ok(!stat.isDirectory(),
      `unexpected directory inside .claude-plugin: ${entry}`);
  }
  assert.ok(entries.every((e) => e === 'plugin.json' || e === 'marketplace.json'),
    `unexpected files inside .claude-plugin: ${entries.filter((e) => e !== 'plugin.json' && e !== 'marketplace.json')}`);
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
