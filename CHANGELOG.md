# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [0.1.0] - 2026-05-26

Initial project import of the working status line.

### Added
- `statusline-command.sh` — Claude Code status line showing model, total/in/out tokens,
  context %, cache hit %, and session/idle timers.
- `install.sh` — user-run installer that copies the script to `~/.claude/` and wires the
  `statusLine` block (with `refreshInterval: 1`) into `settings.json`, with a backup.
- `statusline-monitor.sh` — optional standalone 1Hz monitor for a separate terminal.
- `README.md` documenting fields, live-timer behavior, and install.

### Notes
- Live-ticking timers rely on `statusLine.refreshInterval` (min 1s), which re-runs the
  command on a timer even while idle.
- Idle is computed from the last non-tool-result `user` entry in the transcript and is
  cached by transcript mtime, so the per-second refresh stays cheap.
