# temper

A custom [Claude Code](https://code.claude.com) status line: model, token usage, cache
hit %, context %, and **live-ticking session & idle timers**.

```
Opus 4.7 (1M context) | total:34105 in:34089 out:16 ctx:3% cache:48% | session:21m09s | idle:4m03s
```

## What it shows

| Field | Meaning |
|-------|---------|
| `Opus 4.7 …` | active model display name |
| `total:` | total input + output tokens — **green** `<80k`, **yellow** `80k–120k`, **red** `>120k` |
| `in:` / `out:` | total input / output tokens |
| `ctx:` | context window used % (rendered once Claude Code reports `used_percentage`) |
| `cache:` | cache-read share of the current turn's input |
| `session:` | wall-clock time since the session's first status-line render — turns **red** after 50 min |
| `idle:` | time since your last *real* message (tool results don't count) |

## Live timers

Claude Code re-runs the status-line command on events **and**, when `refreshInterval` is
set, on a timer. Setting `"refreshInterval": 1` makes Claude re-run the script every
second even while idle, so `session:`/`idle:` tick live. Without it the timers only
update on events (model replies, tool runs) and look frozen in between.

The idle calculation caches the last-user-message timestamp keyed by the transcript's
mtime, so the per-second refresh is just arithmetic — Python only re-parses the
transcript when it actually changes.

## Install

```bash
./install.sh
```

This copies `statusline-command.sh` to `~/.claude/` and adds the `statusLine` block
(with `refreshInterval: 1`) to `~/.claude/settings.json`, backing the file up first.
Restart Claude Code afterward.

**Run the installer yourself**, from your shell — Claude Code's auto-mode classifier
blocks the agent from editing `~/.claude/settings.json` (self-modification of agent
config), so the config step has to come from you. The resulting block:

```json
"statusLine": {
  "type": "command",
  "command": "bash /Users/<you>/.claude/statusline-command.sh",
  "refreshInterval": 1
}
```

## Optional: standalone monitor

`statusline-monitor.sh` ticks the two timers live in a **separate terminal window**, with
no settings change. Largely redundant once `refreshInterval` is set, but handy as an
always-visible external readout. It auto-tracks the most-recently-active session.

```bash
bash statusline-monitor.sh   # Ctrl-C to quit
```

It can only show the timers — token/ctx/cache come from Claude Code's stdin JSON, which
an external terminal never receives (and those only change on events anyway).

## Requirements

`bash`, `jq`, `python3`. macOS (the scripts use `stat -f %m`; on Linux swap to
`stat -c %Y`).

## How it works

The status line reads a JSON blob on stdin from Claude Code each invocation (model,
token counts, `transcript_path`, `session_id`). Session start is recorded as a marker
file under `~/.claude/.session-starts/<session_id>`; idle is derived from the newest
non-tool-result `user` entry in the session transcript JSONL. Status-line output goes
only to the terminal UI — the model never sees it, so there is **zero token cost**.
