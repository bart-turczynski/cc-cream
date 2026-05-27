#!/usr/bin/env node
// cc-cream consent-based installer (PRD §7, §14.1). v1 targets the raw-.js
// channel: it writes one `statusLine` block into the user's settings.json after
// showing the change. It detects and confirms before replacing an existing line,
// preserves any user `padding`, and surfaces the trust/restart requirement.
//
// The pure `plan()` function does all the decision-making (no I/O) so it is
// testable; the CLI wrapper at the bottom handles reading/prompting/writing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import readline from 'node:readline';
import { pathToFileURL } from 'node:url';

const TRUST_NOTE =
  'Claude Code must be trusted and possibly restarted for the status line to appear.';

function isInstalled(existing, entrypoint) {
  return (
    !!existing &&
    typeof existing === 'object' &&
    existing.type === 'command' &&
    typeof existing.command === 'string' &&
    existing.command.includes(entrypoint) &&
    existing.refreshInterval === 60
  );
}

// Decide what to do. Returns { settings, changed, messages, needsConsent }.
// `consent` is the user's yes/no when an existing statusLine must be replaced.
export function plan(settings, { entrypoint, consent } = {}) {
  const s = settings && typeof settings === 'object' ? settings : {};
  const existing = s.statusLine;
  const messages = [];

  const desired = { type: 'command', command: `node ${entrypoint}`, refreshInterval: 60 };
  // Preserve any user padding — it shrinks the 80-col budget (PRD §7).
  if (existing && typeof existing === 'object' && existing.padding !== undefined) {
    desired.padding = existing.padding;
  }

  if (isInstalled(existing, entrypoint)) {
    messages.push('cc-cream is already installed — no changes needed.');
    return { settings: s, changed: false, messages, needsConsent: false };
  }

  // An existing (different) statusLine must be confirmed before replacing.
  const hasExisting = existing && typeof existing === 'object';
  if (hasExisting) {
    messages.push(`An existing statusLine is configured:\n  ${JSON.stringify(existing)}`);
    messages.push('Replace it with cc-cream?');
    if (consent !== true) {
      messages.push('Declined — your existing statusLine is unchanged.');
      return { settings: s, changed: false, messages, needsConsent: true };
    }
  }

  messages.push(`Will set statusLine to:\n  ${JSON.stringify(desired)}`);
  messages.push(TRUST_NOTE);
  return { settings: { ...s, statusLine: desired }, changed: true, messages, needsConsent: hasExisting };
}

// ---------------------------------------------------------------------------
// CLI wrapper.
// ---------------------------------------------------------------------------
function settingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json');
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(`${question} [y/N] `, (a) => {
    rl.close();
    resolve(/^y(es)?$/i.test(a.trim()));
  }));
}

async function main() {
  const file = settingsPath();
  let settings = {};
  try {
    settings = JSON.parse(fs.readFileSync(file, 'utf8')) || {};
  } catch {
    settings = {}; // missing or malformed -> start fresh, don't clobber blindly below
  }

  // Default entrypoint: the cc-cream.js sitting next to this installer.
  const entrypoint = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'cc-cream.js');

  let result = plan(settings, { entrypoint });
  // If a replace needs consent, ask now and re-plan with the answer.
  if (!result.changed && result.needsConsent && !isInstalled(settings.statusLine, entrypoint)) {
    for (const m of result.messages) console.log(m);
    const yes = await ask('Replace it with cc-cream?');
    result = plan(settings, { entrypoint, consent: yes });
  }

  for (const m of result.messages) console.log(m);
  if (result.changed) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(result.settings, null, 2)}\n`);
    console.log(`\nWrote ${file}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
