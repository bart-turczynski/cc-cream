# FP Claude Instructions

This file is managed by `fp agent setup claude` and `fp init --agent claude`.

This project uses **fp** for issue tracking. Claude Code agents must follow these rules.

## Guides

Bundled how-to guides for common agent workflows. Print them on demand:

```bash
fp guide plan
fp guide implement
fp guide brainstorm
fp guide extension
```

## Issue Workflow

- Before starting implementation work, load the relevant issue with `fp context <id>`.
- Mark claimed work in progress with `fp issue update --status in-progress <id>`.
- Add comments at meaningful checkpoints with `fp comment <id> "<update>"`.
- Use `fp tree` and `fp issue list` to inspect nearby work before creating duplicate issues.
- When work is complete and verified, mark the issue done with `fp issue update --status done <id>`.

## Project Notes

- Treat this file as fp-managed. Put project-specific Claude Code preferences in `CLAUDE.md`.
- Keep user-authored content in `CLAUDE.md`; fp only ensures that file includes `@FP_CLAUDE.md`.
