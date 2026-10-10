// Strip git's repository-locating variables before any scenario runs.
//
// A pre-push hook in a linked worktree runs with GIT_DIR set to that worktree's
// git dir. Every git call the suite makes inherits process.env: sgit() and
// scripts/release.mjs (run in-process) included. Left in place, those variables
// point a sandbox's `git init`, `commit`, `branch -M main` and `tag` at the real
// repository (CREAM-zdyjsqks). git itself lists the variables to drop.

import { spawnSync } from 'node:child_process';

const localEnvVars = spawnSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' }).stdout ?? '';
for (const name of localEnvVars.split('\n').filter(Boolean)) delete process.env[name];
