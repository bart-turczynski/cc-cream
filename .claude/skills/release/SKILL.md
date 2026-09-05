---
name: release
description: >-
  Cut and publish a cc-cream release — preflight, the one-command version bump,
  the test gate, the irreversible tag push, then pipeline and npm verification.
  Use when asked to cut, ship, publish, release, or tag a version of cc-cream,
  or to check on a release already in flight. Do NOT use to configure the npm
  trusted publisher or the CI variables; that is one-time dashboard setup and
  lives in RELEASING.md.
---

# Releasing cc-cream

`scripts/release.mjs` does the bump, the gate, the commit and the tag in one command. This skill is
the order around it: what to check before, where to stop, and what proves the release landed.

RELEASING.md holds the one-time setup and the rationale — the npm trusted-publisher fields, the
`CATALOGUE_TOKEN` variable, why a script instead of `pnpm version`. Read it when CI fails, not to
cut a release.

## Boundary

Never run `npm publish` locally. Publishing happens in CI via OIDC trusted publishing on a `vX.Y.Z`
tag; a local publish carries no provenance, and the account's 2FA passkey blocks it anyway.

`git push --follow-tags` is the irreversible step — a pushed tag starts a publish that cannot be
undone, and npm refuses to republish a version. Stop for explicit approval before it. Everything
before it is local and discardable.

Do not hand-edit the version in `package.json`, `plugin/.claude-plugin/plugin.json`, or the CHANGELOG
heading. The CI gate (`features/25-publish-and-submit.feature`) fails on any drift between the three;
the script is what keeps them in lockstep.

## 1. Preflight

The script fails fast on its own preconditions, but check them first so a refusal is not the first
thing you learn:

```bash
git checkout main && git pull
git status --porcelain --untracked-files=no          # must be empty
sed -n '/## \[Unreleased\]/,/^## \[[0-9]/p' CHANGELOG.md # must have entries
```

An empty `[Unreleased]` means there is nothing to release — entries accumulate under that heading as
work lands. Untracked files are fine; the script ignores them and never stages them.

Pick the bump from what is under `[Unreleased]`: breaking change → `major`, new segment or config key
→ `minor`, fixes only → `patch`.

## 2. Cut

```bash
pnpm run release minor   # or patch / major / an explicit X.Y.Z
```

One command bumps `package.json`, `plugin/.claude-plugin/plugin.json` and the CHANGELOG in lockstep,
rolls `[Unreleased]` into a dated `## [x.y.z]` section, runs `pnpm test` as the gate, then commits
`Release vX.Y.Z` and writes an **annotated** tag. Nothing is pushed.

If the gate fails the tree is already bumped. Fix the failure and re-run, or back out completely:

```bash
git checkout -- package.json plugin/.claude-plugin/plugin.json CHANGELOG.md
```

## 3. Review, then push

Show what was cut and stop for approval:

```bash
git show --stat HEAD
git tag --points-at HEAD
```

Only after explicit approval:

```bash
git push --follow-tags
```

The tag must be annotated for `--follow-tags` to send it; the script writes it that way. A tag left
local means no pipeline and no publish, which looks like a silent success.

`pnpm run release minor -- --publish` folds the push into step 2. It is a maintainer shortcut for a
hand-driven release — do not use it in an agent-driven run, because it removes the approval stop in
front of the one irreversible action.

## 4. Watch the pipeline

The `publish` job runs on any tag matching `^v\d+\.\d+\.\d+$`, re-runs the full `prepublishOnly`
suite, then publishes via OIDC. `sync-catalogue` follows on the same tag and pushes the generated
`cc-cream/` directory to the catalogue repo — without `CATALOGUE_TOKEN` it no-ops with a message
rather than failing the release.

```bash
glab ci status
```

## 5. Verify it landed

```bash
npm view cc-cream version --safe-chain-skip-minimum-package-age              # equals the tag
npm view cc-cream@X.Y.Z dist.attestations --safe-chain-skip-minimum-package-age  # provenance present
pnpm pack --dry-run                  # plugin/src/, LICENSE, README.md, CHANGELOG.md only
```

`--safe-chain-skip-minimum-package-age` is required, not optional. A Safe-chain wrapper sits in front
of `npm` on this machine and suppresses versions below a minimum age — which is exactly the version
just published. Without the flag `npm view` reports the *previous* release, so a green pipeline reads
as a failed publish. It says so in a trailing `ℹ Safe-chain:` line that is easy to miss under the
version number (CREAM-gwiwsbtm).

A failed `publish` job can be retried from the pipeline view, but the retry fails if that version
already exists on npm. Prefer cutting a new patch over fighting a half-published version.

## Optional, after the tag

- Release notes are separate from publishing: `glab release create vX.Y.Z --notes-file <file>`.
- The `@manual` scenarios in `features/25-publish-and-submit.feature` are the human release runbook,
  not CI: `pnpm run test:manual`.
