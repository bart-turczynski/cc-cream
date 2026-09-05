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

Day-to-day, write changelog entries under a `## [Unreleased]` heading as you work.
At release time, **one command** bumps every version location in lockstep
(`package.json`, `.claude-plugin/plugin.json`), rolls the `[Unreleased]` section
into a dated `## [x.y.z]` section (leaving a fresh empty `[Unreleased]`), gates
on the full test suite, then commits + tags:

```bash
git checkout main && git pull
pnpm run release minor        # or patch / major / an explicit X.Y.Z
```

`scripts/release.mjs` fails *before* touching anything unless you're on a clean
`main` with content under `## [Unreleased]`, so it never leaves a half-bumped tree.
It leaves the tagged release commit staged locally. Review it, then publish —
pushing the tag is what triggers the OIDC npm pipeline:

```bash
git push --follow-tags
```

Or, once you trust it, do the whole thing in one shot (the `--` forwards the flag
through npm):

```bash
pnpm run release minor -- --publish   # bump + test + commit + tag + push
```

> Why a script and not bare `pnpm version`: `pnpm version` only bumps `package.json`,
> leaving `plugin.json` and the CHANGELOG to hand-sync — which the CI gate
> (`features/25`: version == latest CHANGELOG entry, and plugin.json == package.json)
> then fails on. The script keeps all three in lockstep so the gate stays green
> across the bump.

Then **watch it publish:** the `publish` job runs on any `vX.Y.Z` tag, runs the full
`prepublishOnly` suite, then publishes via OIDC. Follow it with `glab ci status`, or
in the project's **Build → Pipelines** view. Confirm:

```bash
npm view cc-cream version            # new version is latest
npm view cc-cream dist.attestations  # provenance present (OIDC releases only)
```

If a publish needs re-running, retry the job from the pipeline view — but it will
fail if that version already exists on npm, so prefer cutting a new patch.

Release notes are optional and separate from publishing: `glab release create vX.Y.Z
--notes-file <file>` after the tag is pushed, if you want them on the project's
Releases page.

## Notes

- The status-line engine stays **Node built-ins only, no runtime deps**. The
  published tarball ships `src/`, `LICENSE`, `README.md`, `CHANGELOG.md` only
  (see the `files` allowlist) — verify with `pnpm pack --dry-run`.
- `@manual`-tagged scenarios in `features/25-*.feature` are the release runbook,
  not CI; run them with `pnpm run test:manual`.
- Plugin / marketplace consumers update independently of npm: the `/cc-cream:setup`
  command writes a self-resolving status-line command, so `/plugin update` picks up
  new versions from the plugin cache with no re-run and no network.
