// Strip git's repository-locating variables before any scenario runs.
//
// A pre-push hook in a linked worktree runs with GIT_DIR set to that worktree's
// git dir. Every git call the suite makes inherits process.env: sgit() and
// scripts/release.mjs (run in-process) included. Left in place, those variables
// point a sandbox's `git init`, `commit`, `branch -M main` and `tag` at the real
// repository (CREAM-zdyjsqks). git itself lists the variables to drop.

import { spawnSync } from 'node:child_process';

const res = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' });
// Fail loudly: carrying on with GIT_DIR set would rewrite the real repository.
if (res.status !== 0) throw new Error(`git rev-parse --local-env-vars failed; refusing to run the suite:\n${res.error ?? res.stderr}`);
for (const name of res.stdout.split(/\r?\n/).filter(Boolean)) delete process.env[name];
