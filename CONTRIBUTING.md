# Contributing

cc-cream is maintained on a **best-effort basis** — issues are welcome and PRs
are reviewed when time allows, but there are no SLAs or roadmap commitments.

## Running the tests

```bash
npm install
npm run hooks   # one-time: register the pre-push git hook (runs coverage)
npm test
```

`npm test` runs Biome lint, knip (dead-code audit), plugin manifest validation,
and all Cucumber scenarios. Everything must stay green.

> `npm run hooks` is opt-in rather than an automatic `prepare` step so the
> published package ships no install-time lifecycle scripts.

For coverage:
```bash
npm run coverage
```

For TDD (re-runs specs on file change):
```bash
npm run watch
```

## Hard constraints

- **No runtime dependencies.** `src/` uses only Node built-ins and local modules.
- **Degrade, never crash.** Malformed or missing stdin, config, or state → exit 0.
- **ESM throughout.** No `require()`.

## Code style

Biome enforces the linting rules on `src/`. The rules that matter most:
`noCommonJs` and `noUndeclaredDependencies` are errors. Run `npm run lint` to
check before pushing.

## Submitting a change

1. Open a GitHub issue to discuss non-trivial changes before investing time.
2. Branch from `main` with a `feature/`, `fix/`, or `chore/` prefix.
3. Keep commits small and focused; use imperative mood in commit messages.
4. Ensure `npm test` is green before opening a PR.

## License

By submitting a contribution you agree that it will be licensed under the
project's MIT license.
