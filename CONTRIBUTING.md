# Contributing

cc-cream is maintained on a **best-effort basis** — issues are welcome and PRs
are reviewed when time allows, but there are no SLAs or roadmap commitments.

## Running the tests

```bash
pnpm install
pnpm run hooks  # one-time: register the pre-push git hook (runs coverage)
pnpm test
```

`pnpm test` runs Biome lint, knip (dead-code audit), plugin manifest validation,
and all Cucumber scenarios. Everything must stay green.

> `pnpm run hooks` is opt-in rather than an automatic `prepare` step so the
> published package ships no install-time lifecycle scripts.

For coverage:
```bash
pnpm run coverage
```

For TDD (re-runs specs on file change):
```bash
pnpm run watch
```

## Hard constraints

- **No runtime dependencies.** `plugin/src/` uses only Node built-ins and local modules.
- **Degrade, never crash.** Malformed or missing stdin, config, or state → exit 0.
- **ESM throughout.** No `require()`.

## Code style

Biome enforces the linting rules on `plugin/src/` and `plugin/hooks/`. The rules that matter most:
`noCommonJs` and `noUndeclaredDependencies` are errors. Run `pnpm run lint` to
check before pushing.

## Agent instructions

`AGENTS.md` — imported by `CLAUDE.md` — is the entry point for AI coding agents.
It in turn imports `FP_AGENTS.md`, which is gitignored and regenerated per
machine, so a fresh clone has no copy and that import resolves to nothing. This
is expected, not a broken file. If you use fp for issue tracking, restore it
with:

```bash
fp agent setup standard
```

Otherwise leave it missing; nothing in the build, tests, or plugin depends on it.

## Submitting a change

1. Open a GitLab issue to discuss non-trivial changes before investing time.
2. Branch from `main` with a `feature/`, `fix/`, or `chore/` prefix.
3. Keep commits small and focused; use imperative mood in commit messages.
4. Ensure `pnpm test` is green before opening a PR.

## License

By submitting a contribution you agree that it will be licensed under the
project's MIT license.
