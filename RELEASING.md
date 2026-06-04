# Releasing cc-cream

cc-cream publishes to npm from CI via **OIDC trusted publishing** — no tokens,
automatic provenance. Releases are cut from `main` and triggered by publishing a
GitHub Release.

## One-time setup (already done)

- **npm trusted publisher** configured for `cc-cream`: owner `bart-turczynski`,
  repo `cc-cream`, workflow filename `publish.yml`. (Fields are case-sensitive.)
- **Workflow** `.github/workflows/publish.yml` with `id-token: write`.
- `package.json` `repository.url` matches the GitHub repo exactly (required by npm).

> npm OIDC cannot publish the *first* version of a brand-new package — that one
> was bootstrapped with a short-lived token. Every release from here is token-free.
> If the workflow is ever renamed, update the trusted-publisher config on npmjs.com.

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
It leaves the tagged release commit staged locally. Review it, then publish — the
GitHub Release event is what triggers the OIDC npm workflow:

```bash
git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

Or, once you trust it, do the whole thing in one shot (the `--` forwards the flag
through npm):

```bash
pnpm run release minor -- --publish   # bump + test + commit + tag + push + gh release create
```

> Why a script and not bare `pnpm version`: `pnpm version` only bumps `package.json`,
> leaving `plugin.json` and the CHANGELOG to hand-sync — which the CI gate
> (`features/25`: version == latest CHANGELOG entry, and plugin.json == package.json)
> then fails on. The script keeps all three in lockstep so the gate stays green
> across the bump.

Then **watch it publish:** the **Publish to npm** workflow runs on the release event,
   runs the full `prepublishOnly` suite, then publishes via OIDC. Confirm:
   ```bash
   npm view cc-cream version            # new version is latest
   npm view cc-cream dist.attestations  # provenance present (OIDC releases only)
   ```

You can also run the workflow manually from the **Actions** tab (`workflow_dispatch`)
— but it will fail if that version already exists on npm, so prefer the release flow.

## Notes

- The status-line engine stays **Node built-ins only, no runtime deps**. The
  published tarball ships `src/`, `LICENSE`, `README.md`, `CHANGELOG.md` only
  (see the `files` allowlist) — verify with `pnpm pack --dry-run`.
- `@manual`-tagged scenarios in `features/25-*.feature` are the release runbook,
  not CI; run them with `pnpm run test:manual`.
- Plugin / marketplace consumers update independently of npm: the `/cc-cream:setup`
  command writes a self-resolving status-line command, so `/plugin update` picks up
  new versions from the plugin cache with no re-run and no network.
