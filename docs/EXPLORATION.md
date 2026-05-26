# cc-cream — Exploration Notes

Working project folder: `temper/` (rename pending).

## What it is

Claude Code status bar plugin. Shows token consumption, cache warmth, cost, session timing.
Differentiator: cache economics focus. Competitors acknowledge cache TTL as a field; none make it the organizing story.

**Name:** C.R.E.A.M. — Cache Rules Everything Around Me. Wu-Tang pun (cash → cache).
**Package name:** `@barturczynski/cc-cream` (unscoped `cream` taken on npm, 14yr abandoned package).

---

## Distribution — three tiers, one source

1. **Claude Code community marketplace** — primary. `/plugin install cc-cream@claude-community`. Submit via https://platform.claude.com/plugins/submit
2. **GitHub repo** — source of truth. Auditable before installing. Security-conscious users land here first.
3. **npm** — fallback. `npx @barturczynski/cc-cream install` for people outside the plugin ecosystem.

All three point to the same code. No divergence.

Official marketplace (`claude-plugins-official`) is Anthropic-curated, invite-only. Target community marketplace first; official comes through adoption.

---

## Architecture

- **Plugin format:** Claude Code native plugin. Repo structure: `plugin.json` + `settings.json` (declares statusLine) + `bin/` (the executable). No custom installer — Claude's plugin system handles wiring.
- **Runtime:** Node.js + TypeScript. Built with `tsup` (esbuild wrapper, zero-config).
- **Execution model:** Single bundled script. Runs fresh per refresh. ~100ms cold start — acceptable, documented. No daemon.
- **Config file:** `~/.claude/cc-cream.json`. Read on every invocation.
- **Session markers:** `~/.claude/.session-starts/<session_id>` — epoch written on first invocation per session.
- **`refreshInterval`:** Set in `settings.json` statusLine config (minimum 1s). Required for live idle-timer ticking. Without it, the status bar only updates on assistant messages — the idle timer would freeze between turns.

### Subagent token accounting

Confirmed from docs (https://code.claude.com/docs/en/prompt-caching#subagents-and-the-cache):

Empirically tested 2026-05-26 in this session (two subagent tests). Sources: separate subagent JSONL files + prompt caching docs.

- **Subagents start cold — unless a sibling recently cached the same prefix.** The first subagent in a session has rd=0 and writes its entire system prompt to cache. A second subagent launched within the 5-min TTL will read the shared base system prompt from cache (in testing: ~6,455 tokens), but ONLY the shared prefix — not the parent session's conversation history.
- **Subagents do NOT inherit the parent's full cache.** The parent session had ~88k tokens cached; the second subagent only read 6,455. Only the base system prompt prefix crosses over between siblings.
- **Subagents use 5-minute TTL, even on a subscription.** The main conversation gets the automatic 1-hour TTL on Claude.ai plans; subagents only get 5 minutes.
- **Subagents warm themselves quickly.** In the substantive test (2 turns: file read + summarize), cache hit % reached 65% by the end.
- **Parent cache is unaffected.** "From the parent's side, the subagent's call and result append to the conversation, leaving the parent's prefix intact."
- **Subagent tokens are NOT in the main session JSONL.** Each subagent writes to a separate file: `<session-id>/subagents/agent-<id>.jsonl`. The parent JSONL has no entry for the subagent's turns; the gap in timestamps confirms it.
- **`current_usage.cache_*` reflects the orchestrator's own last API call.** Subagent turns are invisible to the status bar. During subagent execution the status bar shows stale orchestrator values; it updates only when the orchestrator makes its next call.
- **Forks are different.** A `/fork` inherits the parent's full system prompt, tools, and conversation history, so its first request reads the parent's cache fully. Regular subagents do not.
- **`cost.total_cost_usd` including subagent spend: still unconfirmed.** The session-metrics tool computes cost by reading both parent and subagent JSONLs separately. The native stdin `cost.total_cost_usd` field would need the status line installed to measure before/after a subagent run.

**Implications for cc-cream:**
- Cache hit % dropping during/after subagent execution is expected and not a bug — the first subagent truly starts cold, later ones warm faster from shared prefix. README callout needed.
- Our idle timer measures the *parent session's* idle time. A green indicator means the parent cache is warm, not that subagents will be.
- The ~6,455 token shared prefix (base system prompt) is the "free warm zone" for sibling subagents within a session — small but real.

### Tooling
- `tsup` — build
- `@clack/prompts` — interactive config wizard (for npm install path)
- `vitest` — tests
- `eslint` + `prettier` — lint/format
- `changesets` — semver + changelog automation
- GitHub Actions — CI (lint+test on push) + CD (publish on tag)

---

## Status bar fields

All configurable on/off. Number format: exact or compact (`26k`). Stored in `~/.claude/cc-cream.json`.

### Core (on by default)

| Field | Source | Notes |
|-------|--------|-------|
| Model name | `model.display_name` | |
| Cache hit % | `current_usage.cache_read / total_input` | Core differentiator |
| Context window % | `context_window.used_percentage` | |
| Session cost | `cost.total_cost_usd` | Pre-calculated, no need to compute |
| Session duration | `cost.total_duration_ms` | Wall-clock since session start |
| Idle timer | Computed: `now - last_update_epoch` | Cache warmth indicator — color-coded |
| 5h rate limit | `rate_limits.five_hour.used_percentage` | + reset countdown from `resets_at` |

### Optional (off by default)

| Field | Source | Notes |
|-------|--------|-------|
| Input tokens | `context_window.total_input_tokens` | Low standalone value |
| Output tokens | `context_window.total_output_tokens` | Low standalone value |
| Cache creation tokens | `current_usage.cache_creation_input_tokens` | Niche, but shows cache write cost |
| 7d rate limit | `rate_limits.seven_day.used_percentage` | + reset countdown; lower urgency than 5h |
| API efficiency | `cost.total_api_duration_ms / cost.total_duration_ms` | % of wall time spent waiting on API; shows idle vs active |
| Effort level | `effort.level` | `low/medium/high/xhigh/max`. Absent when model doesn't support it |
| Thinking | `thinking.enabled` | Boolean; display as indicator only |
| Session name | `session_name` | Only present when set via `--name` or `/rename` |
| PR status | `pr.number`, `pr.review_state` | `approved/pending/changes_requested/draft` |

### Cache warmth indicator
Idle timer gains meaning through color. No countdown (going negative after TTL is awkward).
- Green → cache warm
- Yellow → approaching TTL
- Red → likely expired

TTL configurable in `cc-cream.json`. Defaults: ~60min (Claude Code paid), 5min (API users).

**Note:** `refreshInterval` in `settings.json` must be set (e.g. 30s) for the idle timer to visually tick down between turns. Without it the bar only updates on assistant messages.

---

## Rate limits

`rate_limits` is only present for Claude.ai subscribers (Pro/Max) after the first API response. Each window may be independently absent — handle with `?.` / `// empty`.

```
rate_limits.five_hour.used_percentage   — 0-100
rate_limits.five_hour.resets_at         — Unix epoch seconds
rate_limits.seven_day.used_percentage   — 0-100
rate_limits.seven_day.resets_at         — Unix epoch seconds
```

**Display:** show both `used_%` bar and "resets in Xm" derived from `resets_at - Date.now()/1000`. Five-hour on by default (most urgent); seven-day off by default to save space.

---

## Stdin data from Claude Code — full field reference

Corrected from earlier notes. Actual field paths as documented:

```
model.id, model.display_name

workspace.current_dir, workspace.project_dir
workspace.added_dirs                       ← dirs added via /add-dir
workspace.git_worktree                     ← present in linked git worktrees
workspace.repo.host, .owner, .name         ← parsed from origin remote

cost.total_cost_usd
cost.total_duration_ms                     ← wall-clock session time
cost.total_api_duration_ms                 ← time waiting for API responses
cost.total_lines_added, cost.total_lines_removed

context_window.total_input_tokens          ← current context (not cumulative), as of v2.1.132
context_window.total_output_tokens
context_window.context_window_size         ← max size (200k or 1M)
context_window.used_percentage
context_window.remaining_percentage
context_window.current_usage.input_tokens
context_window.current_usage.output_tokens
context_window.current_usage.cache_read_input_tokens
context_window.current_usage.cache_creation_input_tokens

exceeds_200k_tokens                        ← fixed 200k threshold regardless of model

effort.level                               ← low/medium/high/xhigh/max; absent if unsupported
thinking.enabled

rate_limits.five_hour.used_percentage
rate_limits.five_hour.resets_at
rate_limits.seven_day.used_percentage
rate_limits.seven_day.resets_at

session_id
session_name                               ← absent unless set via --name or /rename
transcript_path
version                                    ← Claude Code version

pr.number, pr.url, pr.review_state        ← absent outside git with open PR
worktree.name, .path, .branch, .original_cwd, .original_branch  ← --worktree sessions only

vim.mode                                   ← NORMAL/INSERT/VISUAL/VISUAL LINE; absent if not in vim mode
agent.name                                 ← absent unless --agent flag
output_style.name
```

Full reference: https://code.claude.com/docs/en/statusline

---

## subagentStatusLine (future feature)

Claude Code exposes a second customization surface: `subagentStatusLine` in `settings.json`. It renders a custom row body for each subagent in the agent panel. Input is a `tasks` array with `id, name, type, status, description, label, startTime, tokenCount, tokenSamples, cwd`. Output is one JSON line per row: `{"id": "<task_id>", "content": "<row_body>"}`.

This is in scope for a future version of cc-cream — could show per-subagent cache hit %, cost, or duration. Shelved for now; design data model to accommodate it.

---

## Competing tools — what they actually do

Researched 2026-05-26. Our cache-first angle is still differentiated, but cache TTL is increasingly table-stakes.

### ccstatusline (https://github.com/sirmalloc/ccstatusline)
The most feature-complete tool. Notable fields not elsewhere: **token speeds** (tok/s, rolling 120s window), **compaction counter**, **block timer** (5h progress + reset), **per-model weekly usage** (Sonnet vs Opus separately), **pay-as-you-go overage**, **Jujutsu (jj) VCS support**, free RAM, account email, custom command widgets. Configured via a TUI. Powerline/Nerd Font themes. Multiple status lines. Git widgets are exhaustive (staged/unstaged/untracked/conflicts/SHA/ahead-behind/fork status).

### claude-powerline (https://github.com/Owloops/claude-powerline)
Vim powerline aesthetic. Fields: 5h rate limit + countdown, 7d rate limit, **prompt cache TTL countdown** (time since last turn → cache lifetime), lines added/removed, extended thinking state, effort level, session name, CC version, active subagent. Six themes, four style modes (minimal, powerline, capsule, TUI).

### claude-code-usage-bar (https://github.com/leeguooooo/claude-code-usage-bar)
Most cache-aware of the competitors. Shows: **prompt cache TTL with live color coding** (green >1min, yellow <1min, red cold/expired), 5h + 7d rate limits with reset countdowns, model, context %, session cost. "API-equivalent cost" framing for Pro/Max. 3 styles × 9 themes. Single-line compact.

### claude-hud (https://github.com/jarrodwatts/claude-hud)
Two-line display. Line 1: model, git branch + status. Line 2: context bar (color-coded), 5h/7d rate-limit bars + reset countdown. Optional lines: **tool activity** parsed from transcript JSONL (e.g. `◐ Edit: auth.ts`), **subagent tracking** (name, model, elapsed), **todo progress**, system RAM, CLAUDE.md/MCP/hooks counts. 300ms refreshInterval.

### What to borrow

- **Rate limit countdown** ("resets in 14m") — claude-hud/powerline pattern; use `resets_at - now`
- **API efficiency ratio** — novel, not in any competitor
- **subagentStatusLine** — claude-hud parses transcript for this; we can use the native surface instead (cleaner)

### What NOT to copy

- Lines added/removed: unrelated to cache/token economics — out of scope
- Token speeds (tok/s): requires inter-invocation state, adds complexity, low user value
- Jujutsu VCS: niche, out of scope
- Per-model usage breakdown: complex, shelved (see below)
- System RAM: unrelated to Claude session economics

---

## Key docs

- Plugins overview: https://code.claude.com/docs/en/plugins
- Create plugins guide: https://code.claude.com/docs/en/create-plugins
- Plugins reference (full spec): https://code.claude.com/docs/en/plugins-reference
- StatusLine customization: https://code.claude.com/docs/en/statusline
- Plugin marketplaces: https://code.claude.com/docs/en/plugin-marketplaces
- Community submission form: https://platform.claude.com/plugins/submit
- Official plugin repo: https://github.com/anthropics/claude-plugins-official
- Community plugin repo: https://github.com/anthropics/claude-plugins-community
- Awesome list: https://github.com/ccplugins/awesome-claude-code-plugins

---

## Shelved (revisit later)

- **Multi-model per-session breakdown** — transcript JSONL has the data, but parsing/aggregating is complex. Design data model to accommodate it.
- **Cache TTL countdown** — going negative post-expiry is UX-awkward. Color indicator is enough.
- **Daemon process** — single bundled script cold start is acceptable. No need.
- **subagentStatusLine** — native surface is clean; implement in v2 once core is stable.
- **Token speeds** — inter-invocation state required; complexity vs value doesn't justify it for MVP.
- **Lines added/removed** — productive metric but out of scope; cc-cream is cache/token economics, not coding productivity.

---

## Next session: start here

1. Read the create-plugins guide and plugins-reference docs above.
2. Scaffold `cc-cream` repo: `plugin.json`, `settings.json`, `bin/`, `src/`, `tsconfig.json`, `package.json`.
3. Define `cc-cream.json` config schema (TypeScript type) — use the status bar fields table above as the source of truth.
4. Build the Node.js status line executable against the stdin spec above.
   - Core fields: model, cache hit %, context %, cost, duration, idle timer, 5h rate limit
   - Rate limit display: `used_%` + "resets in Xm" derived from `resets_at`
   - Idle timer: write epoch to `~/.claude/.session-starts/<session_id>` on first invocation, compute elapsed, color-code
5. Wire `refreshInterval: 30` in the plugin's `settings.json` so the idle timer ticks live.
6. Wire up tsup build, vitest, eslint, changesets.
7. Test locally by pointing Claude Code's statusLine at the built binary.
8. Submit to community marketplace.
