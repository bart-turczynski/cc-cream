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

1. **Be on a green `main`:**
   ```bash
   git checkout main && git pull
   npm test            # 0 failures, 0 undefined/pending
   ```
2. **Update `CHANGELOG.md`** — add a section for the new version (move items out of
   any "Unreleased" notes; update the compare/tag link at the bottom).
3. **Bump the version** — this commits and tags in one step:
   ```bash
   npm version patch   # or minor / major (semver)
   git push --follow-tags
   ```
   `npm version` writes `package.json`, commits `vX.Y.Z`, and tags the same commit,
   so the published artifact's version always matches the tag.
4. **Publish the GitHub Release** — this is what triggers the workflow:
   ```bash
   gh release create vX.Y.Z --generate-notes   # or --notes-from-tag
   ```
5. **Watch it publish:** the **Publish to npm** workflow runs on the release event,
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
  (see the `files` allowlist) — verify with `npm pack --dry-run`.
- `@manual`-tagged scenarios in `features/25-*.feature` are the release runbook,
  not CI; run them with `npm run test:manual`.
- Plugin / marketplace consumers update independently of npm: the `/cc-cream:setup`
  command writes a self-resolving status-line command, so `/plugin update` picks up
  new versions from the plugin cache with no re-run and no network.
