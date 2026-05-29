# Security Policy

## Threat model

cc-cream is a pure stdin → stdout status-line renderer. Its attack surface is
intentionally minimal:

- **Reads** the JSON blob Claude Code pipes on stdin. An attacker who can control
  that blob can provide unexpected values; the engine degrades on malformed input
  (exits 0, hides the segment) and never executes any data from stdin.
- **Reads** `~/.claude/cc-cream.json` (optional config). Malformed config falls
  back to built-in defaults field-by-field; a whole-file parse error falls back
  to all defaults.
- **Reads and writes** `~/.claude/cc-cream-state.json` (session state — cost and
  rate-limit samples for the burn projection, keyed by session ID). This file is
  under the user's own home directory.
- **Makes no network calls.** There is no socket, no HTTP request, no DNS lookup,
  no telemetry, no update check. This is verifiable by auditing `src/` — the
  engine imports only Node built-ins and local modules.
- **Has no runtime dependencies.** `npm install` installs dev tools only (test
  runner, linter). Nothing runs at render time except the engine itself.

## Supported versions

Only the latest published version is supported. cc-cream is pre-1.0 (currently
`0.1.0`); the project does not backport fixes.

## Reporting a vulnerability

To report a security issue, email **support@spoonkeyworks.com** with the subject
line `cc-cream security`. Please include:

- A description of the vulnerability and its potential impact
- Steps to reproduce
- Any relevant code or configuration

You will receive an acknowledgement within 7 days. Fixes are made on a
best-effort basis. cc-cream does not run a formal bug-bounty program.

For general bugs or questions, open a GitHub issue instead.
