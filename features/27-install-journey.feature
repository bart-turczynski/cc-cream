@journey
Feature: Installation and uninstallation journey (CREAM-fxsusmgd)
  As a maintainer burned by install-flow regressions
  I want end-to-end smoke tests that drive the real plugin cache, hook,
  installer, and baked status-line command
  So that the seams between them — not just each piece in isolation — stay correct

  # These are INTEGRATION smoke tests. They stage a real plugin cache the way
  # `/plugin install` lays it out, run the actual SessionStart hook and install.js
  # as child processes, and execute the baked statusLine command through `sh -c`
  # exactly as Claude Code would. They guard the connections that unit specs
  # (plan()/planUninstall() in isolation) cannot: cache layout, the settings.json
  # lifecycle, command ORDER, the empty-cache guard (v0.1.15), and symlinked config
  # dirs (v0.1.16). CI-safe — no live `claude` CLI is involved.

  Scenario: Fresh plugin install auto-wires the bar and it renders
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    When the SessionStart auto-setup hook runs
    Then it announces the bar was enabled
    And settings.json gains cc-cream's statusLine
    And running the wired status line command renders the bar

  # Option C: the wired command is a fixed absolute path, so a /plugin update is
  # applied by the SessionStart hook re-pinning it to the new version next session.
  Scenario: After /plugin update the SessionStart hook re-pins to the new version
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When a newer version "0.2.0" appears in the plugin cache
    And the SessionStart auto-setup hook runs
    Then the wired status line command resolves to version "0.2.0"
    And running the wired status line command renders the bar

  Scenario: Uninstall in the documented order leaves no trace
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When the user runs /cc-cream:uninstall
    Then settings.json on disk no longer has a statusLine
    When /plugin uninstall removes the plugin cache
    Then no orphaned statusLine remains

  # CREAM-rhtrzwss: run from the cache (as the slash command does), the receipt's
  # escape-hatch line must be the real, version-accurate cache path — copy-pasteable
  # and free of the markdown-stripped `<version>` placeholder that broke it before.
  Scenario: The uninstall receipt advertises the real cached install.js path
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When the user runs /cc-cream:uninstall
    Then the uninstall receipt points at the cached install.js for version "0.1.16"
    And the uninstall receipt has no angle-bracket placeholder

  Scenario: Uninstall in the WRONG order degrades silently (v0.1.15 regression)
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When /plugin uninstall removes the plugin cache
    Then the orphaned statusLine command still lives in settings.json
    And running the wired status line command prints nothing and exits zero

  # The realistic ghost-bar trap (CREAM-uchemxln): /plugin uninstall is PARTIAL —
  # it deregisters cc-cream but LEAVES the cache, so the entrypoint still exists and
  # the `[ -f … ]` guard can't fire. The renderer's own registry check is what stops
  # the zombie bar here, proven end-to-end through the baked `sh -c` command.
  Scenario: A partial /plugin uninstall (cache kept) self-suppresses the orphaned bar
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When /plugin uninstall deregisters cc-cream but leaves the cache
    Then the orphaned statusLine command still lives in settings.json
    And running the wired status line command prints nothing and exits zero

  Scenario: cc-cream-setup --uninstall clears an orphaned statusLine with no cache (recovery)
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    And /plugin uninstall removed the plugin cache
    When the npm bin clears the wiring with the checked-out install.js
    Then settings.json on disk no longer has a statusLine

  Scenario: A symlinked config dir still renders the bar (v0.1.16 regression)
    Given a Claude config dir reached through a symlink
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    Then running the wired status line command renders the bar

  Scenario: Auto-setup never clobbers a foreign status line
    Given a fresh Claude config dir
    And settings.json already has a foreign statusLine
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    When the SessionStart auto-setup hook runs
    Then the foreign statusLine is left unchanged
    And it points the user to /cc-cream:setup

  Scenario: Auto-setup never re-wires a bar the user removed
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    And the user runs /cc-cream:uninstall
    When the SessionStart auto-setup hook runs
    Then settings.json still has no statusLine

  # The hook won't re-wire after a removal (the marker, above), but the user can
  # change their mind and re-enable explicitly — manual setup is not marker-gated.
  Scenario: /cc-cream:setup re-enables the bar after the user removed it
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    And the user runs /cc-cream:uninstall
    When the user runs /cc-cream:setup
    Then settings.json gains cc-cream's statusLine
    And running the wired status line command renders the bar

  # The hook points foreign-status-line users at /cc-cream:setup; running it must
  # not clobber their line non-interactively — only --force replaces it.
  Scenario: /cc-cream:setup over a foreign status line is non-destructive without --force
    Given a fresh Claude config dir
    And settings.json already has a foreign statusLine
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    When the user runs /cc-cream:setup
    Then the foreign statusLine is left unchanged
    When the user runs /cc-cream:setup with --force
    Then settings.json gains cc-cream's statusLine

  # Self-heal: after a wrong-order uninstall left an orphaned (inert) statusLine,
  # reinstalling the plugin brings the cache back and the same baked command works.
  Scenario: Reinstalling the plugin heals an orphaned status line
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    And /plugin uninstall removed the plugin cache
    When the plugin is reinstalled in the cache at version "0.1.16"
    Then running the wired status line command renders the bar

  # Option C has no render-time fallback: the wired command points at one fixed
  # version. If that version is pruned before the SessionStart hook re-pins, the
  # `[ -f … ] || exit 0` guard degrades to a silent empty bar; the next session
  # (a fresh CLAUDE_PLUGIN_ROOT) heals it.
  Scenario: A wired command degrades silently when its pinned version is pruned
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When version "0.1.16" is pruned from the cache
    Then running the wired status line command prints nothing and exits zero
