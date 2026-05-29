# cc-cream — Public Release Plan

> Canonical source of truth for the public-release effort. Gherkin user stories
> and the FP release epic are derived from and must stay aligned with this file.
> If a user story exposes a flaw here, **update this file first**, then the story.

## Goal

Make cc-cream publicly installable, optimizing for the single hardest target —
**landing in Anthropic's official community plugin catalog**
(`anthropics/claude-plugins-community`). Satisfying that target's requirements
produces a superset that also satisfies every lower-friction channel.

## Channel priority (apex → fallback)

1. **Anthropic community catalog** — the goal. `/plugin install cc-cream@…` after review.
2. **Self-hosted marketplace** — `/plugin marketplace add bart-turczynski/cc-cream`. Guaranteed fallback if the catalog stalls; comes free from the same repo structure.
3. **npm** — `npx -y cc-cream@latest` / `npm i -g cc-cream`.
4. **GitHub** — public source of record; clone + run `install.js` manually. Also the audit/review path for users who want to read the code first.

Optimize for #1; #2–#4 fall out of the same artifacts.

## Locked decisions

| Decision | Value | Rationale |
|---|---|---|
| Name | `cc-cream` | Brand; npm-free; kebab-case (catalog-enforced). |
| `displayName` | `cc-cream` | Explicit lowercase wordmark; prevents UI title-casing. Matches catalog norm (lowercase kebab). |
| Description hook | "Claude Code Cache Rules Everything Around Me" | C.R.E.A.M. backronym lives in description/README, **not** the name. |
| Owner (public) | Bart Turczynski / support@spoonkeyworks.com | Keeps work email (@tidio.net) out of public metadata. |
| Maintenance posture | Best-effort, issues-welcome, no promises | Sets README/SUPPORT/CONTRIBUTING tone. |
| Network / telemetry | **None.** Engine never makes a network call. | Privacy + performance + zero-tokens story; easiest possible review disclosure. |
| Update notifications | Channel-native only (`/plugin update`, npm). Optional opt-in `/cc-cream:update` for standalone cohort. | Never silent, never from render path. |
| Platforms (v1) | macOS + Linux only | Windows is a labeled fast-follow; halves setup-command + test surface. |
| Auto-update mechanism | Cache-glob self-resolving command (claude-hud pattern) | `/plugin update` applies live, zero network, no re-run of setup. |
| Repo layout | Single repo: `marketplace.json` + `plugin.json` + `package.json` together, `source: "./"` | Proven by claude-hud; one repo serves all channels. |
| Setup command impl | Thin `commands/setup.md` shells out to existing tested `install.js` | Deterministic write, not LLM-driven. |
| Initial public version | `0.1.0` | Signals "early"; reserves 1.0 for post-feedback. Feature-complete already. |
| License | MIT (add `LICENSE` file) | Matches `package.json`; hard catalog requirement. |

## Auto-update mechanism (core technical decision)

The statusLine `command` written to the user's `~/.claude/settings.json` must
**not** hardcode a versioned path. It re-discovers the latest installed plugin
version on every render:

```bash
{NODE} "$(ls -1d "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"/plugins/cache/*/cc-cream/*/ 2>/dev/null | sort -V | tail -1)src/cc-cream.js"
```

- `{NODE}` is the **absolute path** to the node binary, resolved once at setup time (`command -v node`) and written literally into the command — never a bare `node`, since the statusLine subprocess may not inherit the user's `PATH`.
- `*/cc-cream/*/` matches `cache/<marketplace>/cc-cream/<version>/`; the `-d .../*/` glob yields directory paths with a **trailing slash**, so concatenating `src/cc-cream.js` directly produces `.../<version>/src/cc-cream.js`. `sort -V | tail -1` picks the highest version.
- **First-install / empty-cache:** if the glob matches nothing the command substitution is empty and the entrypoint would be a bare `src/cc-cream.js`; this only occurs if setup runs before the plugin is cached, which the plugin-mode flow precludes. The manual path (copy-to-home) is unaffected. Renderer still degrades to exit 0 on any failure.
- **`sort -V` caveat:** reliable for `MAJOR.MINOR.PATCH`; pre-release tags (`0.1.0-rc.1`) would sort unexpectedly. cc-cream ships plain semver, so this is acceptable; revisit if pre-releases ever land in the cache.
- `refreshInterval: 60` and existing install.js behavior (preserve `padding`, back up + consent-to-replace an existing statusLine) are retained.
- `COLUMNS` export: evaluate whether the fixed ≤80-col renderer needs it (claude-hud needs it for dynamic width; cc-cream likely does not). Add only if layout requires.

When `/plugin update` drops a new version dir into the cache, the next render
switches to it automatically. No network, no re-run of setup.

**Risk:** depends on Claude Code's undocumented cache layout
(`plugins/cache/*/name/*/`). Accepted; patch via issues as claude-hud does.

## Phased plan

### Phase 1 — Repo & metadata foundation
- **1.1** Add `LICENSE` (MIT).
- **1.2** Create `.claude-plugin/plugin.json`: `name`, `displayName`, `description` (with backronym), `version`, `author {name, email}`, `homepage`, `repository`, `license`, `keywords` (non-empty), `commands: ["./commands/setup.md"]`.
- **1.3** Create `.claude-plugin/marketplace.json`: **top-level `name: "cc-cream"` and `description`** (required — `claude plugin validate` rejects a marketplace with no root `name`; discovered during S23, 2026-05-29), `owner {name, email}`, and a single-plugin entry with `source: "./"`, `category: "monitoring"`, tags, **plus per-entry `description` and `homepage`** (community-catalog schema). Doubles as the self-hosted marketplace; its `name` is the `@cc-cream` suffix in `/plugin install cc-cream@cc-cream`.
- **1.4** Polish `package.json` for npm: `engines.node`, `files` allowlist (ship `src/`, exclude tests/fixtures/docs/archive), `repository`, `bugs`, `homepage`, `keywords`, real `author`.

**Manifest layout (explicit):** both `plugin.json` and `marketplace.json` live *inside* `.claude-plugin/` (proven by claude-hud, a catalog-listed statusLine plugin) — they are the only two files in that directory. The "components live at repo root" rule applies only to actual plugin *components* (`commands/`, `agents/`, `hooks/`, source modules), which must NOT go inside `.claude-plugin/`.

**Identity (explicit):** `plugin.json.author` and `marketplace.json.owner` use the **same** name + email — `Bart Turczynski` / `support@spoonkeyworks.com`. The work `@tidio.net` address never appears in any committed metadata.

### Phase 2 — Auto-update setup command
- **2.1** Extend `install.js` pure `plan()` with a second command strategy that emits the cache-glob auto-update command (vs. copy-to-home), with absolute `node` path resolution.
- **2.2** Add `commands/setup.md` (`/cc-cream:setup`) that shells out to `node ${CLAUDE_PLUGIN_ROOT}/src/install.js --plugin`.
- **2.3** Demote copy-to-home to the documented GitHub/manual path (`node src/install.js`), unchanged.
- **2.4** Verify whether the renderer needs `COLUMNS` exported; add only if needed.

### Phase 3 — Quality gates
- **3.1** Add a `validate` npm script invoking `claude plugin validate .`. Wire it into **pretest** (alongside lint + knip), but make it **gracefully skip when the `claude` CLI is absent** so contributors without it installed aren't blocked. Run `--strict` (warnings-as-errors) as a **pre-submission** check, not the everyday blocking gate — `--strict` can fail on benign unrecognized-field warnings, so we hold it for the submission-readiness pass, where a clean report is the goal.
- **3.2** Manual install test on macOS **and** Linux: marketplace add → install → `/cc-cream:setup` → bar renders → `/plugin update` swaps versions live (auto-update claim verified).

### Phase 4 — User-facing docs & assets
- **4.1** Rewrite `README.md` for end users: what it shows, screenshot/asciinema of the real bar, three install paths, `~/.claude/cc-cream.json` config reference, segment catalog, min CC version (2.1.132; 2.1.145 for effort/thinking), prominent "no network / no telemetry / zero deps / zero tokens" disclosure.
- **4.2** Add `SECURITY.md` (threat model: reads stdin, reads/writes one local state file, no network) and a brief best-effort `CONTRIBUTING.md`.
- **4.3** Keep dev-facing `CLAUDE.md` / `docs/` for contributors.

### Phase 5 — Publish & submit (priority order)
- **5.1** GitHub: make repo public, tag release, write release notes.
- **5.2** npm: `npm publish cc-cream@0.1.0`; document `npx -y cc-cream@latest`.
- **5.3** Self-hosted marketplace: live via 1.3; document `/plugin marketplace add bart-turczynski/cc-cream`.
- **5.4** Community catalog (the goal): submit repo at clau.de/plugin-directory-submission.

**Release gate vs. post-submission observation:** the *controllable* outcomes are release gates — repo public + tagged + release notes, `npm publish` succeeded, self-hosted marketplace documented, submission form accepted. The outcomes that depend on **external actors and time** are NOT gates, only post-submission observations to watch for: npm registry indexing lag (~minutes before `npx` resolves), Anthropic's security scan + human review (~days), and the cc-cream entry appearing in the catalog `marketplace.json` pinned to a commit SHA. Track these on a checklist; never block CI on them.

### Phase 6 — Fast-follow (post-launch)
- **6.1** Windows support: parallel `statusline.ps1` wrapper + Windows node-detection.
- **6.2** Optional `/cc-cream:update` command: explicit, opt-in GitHub-Releases check for the standalone cohort.

## Critical path

Phase 1 → 2 → 3 → 5.4. Everything else is polish or fallback that comes nearly
free along the way.

## Out of scope for v1
- Windows (fast-follow).
- Background/automatic update checks (channel-native only; optional opt-in command later).
- Any network calls from the engine.
- Configuration UI beyond the existing `~/.claude/cc-cream.json`.

## Catalog requirements (reference)
- **Hard:** `.claude-plugin/plugin.json` (only `name` strictly required), `README.md`, `LICENSE`.
- **Recommended:** `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`.
- Submission: web form at clau.de/plugin-directory-submission → automated security scan + human review (~days) → Anthropic CI pins to commit SHA → nightly sync.
- Must disclose any network access / data collection. cc-cream: **none.**
- `cc-cream` hits no reserved-name rule (reserved: `claude-`/`anthropic-` prefixes + explicit blocklist).

## Test convention (added during S25)
Cucumber runs strict (fails on undefined/pending). Scenarios that depend on external actors or real-world/destructive actions (making the repo public, `npm publish`, catalog submission acceptance, npm indexing, Anthropic review) are tagged **`@manual`** and excluded from the default profile (`cucumber.json` default `tags: "not @manual"`), so `npm test` stays green. They remain runnable via `npm run test:manual` and serve as the **release runbook** — the human checklist for Phase 5.

## Implementation status (2026-05-29)
Slices S20–S25 implemented and committed on branch `feature/public-release` (7 commits); `npm test` green (183 scenarios, 0 undefined/pending), coverage ~97.5%. **Remaining = the `@manual` runbook itself**: make the GitHub repo public + tag + release notes (5.1), `npm publish` 0.1.0 (5.2), then submit at clau.de/plugin-directory-submission (5.4). Those are manual actions for the maintainer; the codebase is release-ready.
