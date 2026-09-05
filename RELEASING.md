# Releasing cc-cream

cc-cream publishes to npm from CI via **OIDC trusted publishing** — no tokens,
automatic provenance. Releases are cut from `main` and triggered by **pushing a
version tag**; on GitLab the tag itself starts the pipeline, so there is no
separate "create a release" step to forget.

## One-time setup

- **npm trusted publisher** configured for `cc-cream`: namespace `bart-turczynski`,
  project `cc-cream`, top-level CI file path `.gitlab-ci.yml`. (Fields are
  case-sensitive.) npm only accepts OIDC from **GitLab.com shared runners** —
  a self-hosted runner cannot publish.
- **Environment name must be left EMPTY**, and **"Allow `npm publish`" must be
  ticked**. The `publish` job declares no `environment:`, so GitLab sends no
  environment claim and a value here makes npm demand one that never arrives; and
  the job runs a bare `npm publish`, not `npm stage publish`, so the unticked
  default rejects it. Both are in npm's "cannot be changed later" set — getting
  either wrong means deleting the connection and recreating it.
- **Pipeline** `.gitlab-ci.yml`, `publish` job, with the `id_tokens` block
  (`NPM_ID_TOKEN` audience `npm:registry.npmjs.org`, plus `SIGSTORE_ID_TOKEN`).
- **`CATALOGUE_TOKEN`** CI/CD variable (masked + protected) holding a token with
  `write_repository` on `bart-turczynski/claude-plugins`, for the `sync-catalogue`
  job. `CI_JOB_TOKEN` cannot push across projects. Without it the sync job no-ops
  with a message rather than failing the release.
- `package.json` `repository.url` matches the GitLab project exactly (required by npm).

> npm OIDC cannot publish the *first* version of a brand-new package — that one
> was bootstrapped with a short-lived token. Every release from here is token-free.
> If `.gitlab-ci.yml` is ever renamed or moved, update the trusted-publisher config
> on npmjs.com to match, or publishing fails.

## Cutting a release

The procedure — preflight, the bump, the gate, the tag push, and the checks that
prove it landed — lives in the `release` skill
(`.claude/skills/release/SKILL.md`), so an agent executes it in a fixed order
with the approval stop in front of the one irreversible step. Ask for a release
and it loads; read the file directly to follow it by hand.

This document is the part the skill does not repeat: what was configured once,
why it has to be exactly that, and what to check when CI fails.

> **Why a script and not bare `pnpm version`:** `pnpm version` only bumps
> `package.json`, leaving `plugin/.claude-plugin/plugin.json` and the CHANGELOG to
> hand-sync — which the CI gate (`features/25`: version == latest CHANGELOG entry,
> and plugin.json == package.json) then fails on. `scripts/release.mjs` keeps all
> three in lockstep so the gate stays green across the bump, and its preflight
> refuses anything but a clean `main` with content under `## [Unreleased]`, so it
> never leaves a half-bumped tree.

> **If a publish fails:** retry the job from the pipeline view, but the retry
> fails if that version already exists on npm — prefer cutting a new patch over
> fighting a half-published version. A tag that was never pushed means no
> pipeline ever fired, which looks like a silent success.

## Notes

- The status-line engine stays **Node built-ins only, no runtime deps**. The
  published tarball ships `src/`, `LICENSE`, `README.md`, `CHANGELOG.md` only
  (see the `files` allowlist) — verify with `pnpm pack --dry-run`.
- `@manual`-tagged scenarios in `features/25-*.feature` are a hand-walked
  publish checklist, not CI and not a runnable command — read
  `features/25-publish-and-submit.feature` and work down the list. They have no
  step definitions on purpose: they end in a web form, npm's indexing and
  Anthropic's review, none of which a test process can assert.
- Plugin / marketplace consumers update independently of npm: the `/cc-cream:setup`
  command writes a self-resolving status-line command, so `/plugin update` picks up
  new versions from the plugin cache with no re-run and no network.
