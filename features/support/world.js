// Custom Cucumber World for cc-cream. Each scenario builds up a `data` object
// (serialized to the engine's stdin) plus an optional config file and env
// overrides, then `run()` spawns the engine exactly as Claude Code would.

import { setWorldConstructor, World, Before, After } from '@cucumber/cucumber';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const ENGINE = path.join(REPO, 'src', 'cc-cream.js');

export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');

// Color of the segment matched by `re`, by inspecting the ANSI escape (if any)
// immediately preceding the matched text. Unwrapped text reads as "neutral".
export function colorOf(output, re) {
  const m = output.match(re);
  if (!m) return null;
  const before = output.slice(Math.max(0, m.index - 6), m.index);
  if (before.endsWith('\x1b[31m')) return 'red';
  if (before.endsWith('\x1b[32m')) return 'green';
  if (before.endsWith('\x1b[33m')) return 'amber';
  return 'neutral';
}

class CcCreamWorld extends World {
  constructor(opts) {
    super(opts);
    this.data = {};         // becomes stdin JSON unless rawStdin is set
    this.rawStdin = null;   // verbatim stdin (for malformed-input scenarios)
    this.configRaw = null;  // contents of ~/.claude/cc-cream.json, or null
    this.env = {};          // extra env vars for the engine
    this.now = Date.now();
  }

  // Absolute path to a transcript file inside the sandbox HOME, with its mtime
  // set `minutesAgo` before now. Returns the path to put in transcript_path.
  makeTranscript(minutesAgo) {
    const p = path.join(this.home, 'transcript.jsonl');
    fs.writeFileSync(p, '{}\n');
    const when = new Date(this.now - minutesAgo * 60_000);
    fs.utimesSync(p, when, when);
    return p;
  }

  run() {
    if (this.configRaw != null) {
      fs.writeFileSync(path.join(this.home, '.claude', 'cc-cream.json'), this.configRaw);
    }
    const stdin = this.rawStdin != null ? this.rawStdin : JSON.stringify(this.data);
    const env = {
      ...process.env,
      HOME: this.home,
      // Neutralize cache-TTL env unless a scenario sets it explicitly.
      FORCE_PROMPT_CACHING_5M: '',
      ENABLE_PROMPT_CACHING_1H: '',
      ...this.env,
    };
    const start = process.hrtime.bigint();
    const res = spawnSync(process.execPath, [ENGINE], { input: stdin, env, encoding: 'utf8' });
    this.durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    this.exitCode = res.status;
    this.stdout = res.stdout ?? '';
    this.stderr = res.stderr ?? '';
    this.plain = stripAnsi(this.stdout);
    return this;
  }
}

setWorldConstructor(CcCreamWorld);

Before(function () {
  this.home = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-cream-'));
  fs.mkdirSync(path.join(this.home, '.claude'), { recursive: true });
});

After(function () {
  if (this.home) fs.rmSync(this.home, { recursive: true, force: true });
});
