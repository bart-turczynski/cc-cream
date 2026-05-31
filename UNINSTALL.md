# Uninstalling cc-cream

## Plugin users

Run in this order:
```
/cc-cream:uninstall          # 1. removes the statusLine wiring
/plugin uninstall cc-cream   # 2. drops the plugin
```

`/cc-cream:uninstall` cleans cc-cream's regenerable scratch (the copied runtime and session-state file). Add `--purge` to also delete your `~/.claude/cc-cream.json` config. The bar disappears on your next message — restart an already-open session to drop it immediately.

### If you ran the commands in the wrong order

`/cc-cream:uninstall` lives inside the plugin, so once you run `/plugin uninstall` it's gone. Neither host command clears the `statusLine` block or the version cache. The renderer notices when it's running from a cache the host no longer lists as installed and self-suppresses, so the bar stops on the next session even though the inert `statusLine` line still lingers in `settings.json`.

To clear that leftover line once the plugin is gone, use the copy of the uninstaller still in the cache — npm-free and always present. `VERSION` is the single directory under that path (run the `ls` first to read it off); `/cc-cream:uninstall` also prints the fully-resolved command:

```bash
ls ~/.claude/plugins/cache/cc-cream/cc-cream/        # e.g. 0.3.3
node ~/.claude/plugins/cache/cc-cream/cc-cream/VERSION/src/install.js --uninstall
# add --purge to also remove your config
```

The npm bin does the same job, but **not always**: a freshly published version is blocked by npm's min-package-age safe-chain guard (reports "No versions available") until it ages in, so prefer the cache route:

```bash
npx -y -p cc-cream cc-cream-setup --uninstall
```

You can also remove the `statusLine` key from `~/.claude/settings.json` by hand.

## npm / manual users

```bash
cc-cream-setup --uninstall                 # npm (add --purge to also remove the config)
node cc-cream/src/install.js --uninstall   # manual clone
```

## What gets removed

Uninstall removes the `statusLine` block **only if it is cc-cream's** — a statusLine you wired for something else is left untouched. It always cleans the regenerable scratch (the copied runtime and session state, both recreated on a reinstall). `--purge` additionally removes your `~/.claude/cc-cream.json` config.

Running `cc-cream-setup` non-interactively will overwrite an existing *cc-cream* statusLine but never a foreign one — pass `--force` to replace regardless.

## Checking what's left behind

`cc-cream-setup --status` prints a read-only footprint report: the statusLine wiring, every cached plugin version (the host never garbage-collects these), the marketplace clone and registration, the auto-wire marker, session state, config, and the manual runtime copy. Use it to confirm a clean slate or see exactly what to remove.
