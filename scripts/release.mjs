#!/usr/bin/env node
// One-command release. Every prior release hand-synced four version locations
// (package.json, package-lock.json, .claude-plugin/plugin.json, and the
// CHANGELOG's first `## [x.y.z]` heading) and the CI gate punished any drift.
// `npm version` only touches the first two, so it desynced the rest. This script
// bumps all four in lockstep, rolls the CHANGELOG's `[Unreleased]` section into a
// dated version section (leaving a fresh empty `[Unreleased]`), gates on the test
// suite, then commits + tags. With --publish it also pushes and creates the
// GitHub Release that triggers the OIDC npm publish.
//
//   node scripts/release.mjs <patch|minor|major|X.Y.Z> [--publish] [--skip-tests]
//
// Preflight fails fast (must be on a clean main, [Unreleased] must have content),
// so it never leaves a half-bumped tree. The pure helpers are exported for tests.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = (...segs) => path.join(ROOT, ...segs);

// Compute the next version from a bump keyword or accept an explicit X.Y.Z.
export function nextVersion(current, bump) {
  if (/^\d+\.\d+\.\d+$/.test(bump)) return bump;
  const [maj, min, pat] = current.split('.').map(Number);
  if (bump === 'major') return `${maj + 1}.0.0`;
  if (bump === 'minor') return `${maj}.${min + 1}.0`;
  if (bump === 'patch') return `${maj}.${min}.${pat + 1}`;
  throw new Error(`Unknown bump "${bump}" — use patch | minor | major | X.Y.Z`);
}

// Roll the CHANGELOG: the content currently under `## [Unreleased]` becomes the
// new `## [version] — date` section, with a fresh empty `## [Unreleased]` left on
// top for the next cycle. Throws if there's nothing to release.
export function rollChangelog(text, version, date) {
  const marker = '## [Unreleased]';
  const idx = text.indexOf(marker);
  if (idx === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section.');
  const body = text.slice(idx + marker.length).split(/\n## \[/)[0].trim();
  if (!body) throw new Error('Nothing under "## [Unreleased]" — add entries before releasing.');
  return text.replace(marker, `## [Unreleased]\n\n## [${version}] — ${date}`);
}

function setJsonVersion(file, version) {
  const obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  obj.version = version;
  fs.writeFileSync(file, `${JSON.stringify(obj, null, 2)}\n`);
}

function git(cmd) {
  return execSync(`git ${cmd}`, { cwd: ROOT, encoding: 'utf8' }).trim();
}
function run(cmd) {
  execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
}

function main() {
  const args = process.argv.slice(2);
  const bump = args.find((a) => !a.startsWith('--'));
  const publish = args.includes('--publish');
  const skipTests = args.includes('--skip-tests');
  if (!bump) {
    console.error('Usage: node scripts/release.mjs <patch|minor|major|X.Y.Z> [--publish] [--skip-tests]');
    process.exit(1);
  }

  // Preflight — fail before mutating anything.
  if (git('rev-parse --abbrev-ref HEAD') !== 'main') {
    console.error('Refusing to release: not on main (releases are cut from main — RELEASING.md).');
    process.exit(1);
  }
  // Tracked changes only — stray untracked files (scratch notes, editor configs)
  // must neither block a release nor get swept into the release commit.
  if (git('status --porcelain --untracked-files=no')) {
    console.error('Refusing to release: tracked files have uncommitted changes (the release commit must be just the bump).');
    process.exit(1);
  }
  const current = JSON.parse(fs.readFileSync(at('package.json'), 'utf8')).version;
  const version = nextVersion(current, bump);
  const tag = `v${version}`;
  const date = new Date().toISOString().slice(0, 10);
  const rolled = rollChangelog(fs.readFileSync(at('CHANGELOG.md'), 'utf8'), version, date); // throws if [Unreleased] empty

  console.log(`Releasing ${current} → ${version} (${tag}, ${date})`);

  // Bump every version location in lockstep.
  run(`npm version ${version} --no-git-tag-version`); // package.json + package-lock.json
  setJsonVersion(at('.claude-plugin', 'plugin.json'), version);
  fs.writeFileSync(at('CHANGELOG.md'), rolled);

  // Gate, then commit + tag — staging ONLY the bump files, never a stray
  // untracked file that happens to be lying around.
  if (!skipTests) run('npm test');
  run('git add package.json package-lock.json .claude-plugin/plugin.json CHANGELOG.md');
  run(`git commit -m "Release ${tag}"`);
  run(`git tag ${tag}`);

  if (publish) {
    run('git push --follow-tags');
    run(`gh release create ${tag} --generate-notes`);
    console.log(`\nReleased ${tag}. The "Publish to npm" workflow runs on the release event (OIDC).`);
  } else {
    console.log(`\nStaged ${tag} locally. To publish:\n  git push --follow-tags\n  gh release create ${tag} --generate-notes`);
  }
}

// Run only when invoked directly, so tests can import the pure helpers.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
