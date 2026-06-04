// Shared settings.json I/O for the installer (src/install.js) and the
// SessionStart hook (hooks/auto-setup.js). Both must read settings.json without
// ever destroying it, and write it atomically. Previously each carried its own
// copy of this safety-critical parsing; they live here once so they can't drift.
//
// `readSettings` does NOT decide policy — it classifies the file and lets each
// caller choose what to do (the installer refuses + exits on a corrupt file; the
// hook stays silent and leaves it alone). That split is the whole reason this is
// a classifier returning `{ state, value }` rather than a function that throws.

import fs from 'node:fs';
import process from 'node:process';

// Read and classify settings.json. Returns `{ state, value }`:
//   missing   — file absent              → value {}
//   empty     — present but whitespace    → value {}
//   object    — valid JSON object         → value <parsed>
//   nonobject — valid JSON, not an object → value null
//   corrupt   — invalid JSON              → value null
//   unreadable— read failed (perms, …)    → value null
// The destructive-write guard lives in the caller: a non-{missing,empty,object}
// state means "we cannot safely overwrite this — it holds the user's other
// config (permissions, hooks, plugins, MCP)".
export function readSettings(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return err.code === 'ENOENT' ? { state: 'missing', value: {} } : { state: 'unreadable', value: null };
  }
  if (raw.trim() === '') return { state: 'empty', value: {} };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { state: 'corrupt', value: null };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: 'nonobject', value: null };
  }
  return { state: 'object', value: parsed };
}

// True when `state` is safe to start from and overwrite (the file holds nothing
// to lose, or a well-formed object we can extend).
export function isSafeToWrite(state) {
  return state === 'missing' || state === 'empty' || state === 'object';
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
