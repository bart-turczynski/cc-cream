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

  Scenario: A newer cached version is picked up live by the wired command
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When a newer version "0.2.0" appears in the plugin cache
    Then the wired status line command resolves to version "0.2.0"
    And settings.json still holds the same statusLine command

  Scenario: Uninstall in the documented order leaves no trace
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When the user runs /cc-cream:uninstall
    Then settings.json on disk no longer has a statusLine
    When /plugin uninstall removes the plugin cache
    Then no orphaned statusLine remains

  Scenario: Uninstall in the WRONG order degrades silently (v0.1.15 regression)
    Given a fresh Claude config dir
    And the cc-cream plugin freshly installed in the cache at version "0.1.16"
    And the auto-setup hook has wired the bar
    When /plugin uninstall removes the plugin cache
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
