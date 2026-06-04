Feature: Ghost-bar self-defense when orphaned in the plugin cache (CREAM-uchemxln)
  As a user who removed the cc-cream plugin
  I want the status bar to stop on its own
  So that an uninstalled plugin can't leave a zombie bar running every session

  # No Claude Code host removal path deletes our statusLine OR the version cache:
  # /plugin uninstall and /plugin marketplace remove both leave the cache tree AND
  # the statusLine in settings.json (verified 2026-05-30, probes B/E/F). So a
  # plugin-cache copy of the renderer keeps executing after the plugin is gone — and
  # once the plugin is gone, /cc-cream:uninstall is gone too, so the user has no
  # in-product way out. install.js's `[ -f entrypoint ] || exit 0` guard can't fire
  # (the cache is never GC'd). The reliable signal is the host registry: when we're
  # running FROM the plugin cache while cc-cream is absent from installed_plugins.json,
  # we exit 0 silently. Only the cache path pays the cost; manual/dev installs skip it.

  Background:
    Given a session JSON that renders a bar

  Scenario: An orphaned cache renderer (plugin gone, no registry) exits silently
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry file is absent
    When cc-cream runs
    Then the output is empty
    And cc-cream exits 0

  Scenario: An orphaned cache renderer (registry lists other plugins, not cc-cream) exits silently
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry lists other plugins but not cc-cream
    When cc-cream runs
    Then the output is empty
    And cc-cream exits 0

  Scenario: A still-installed cache renderer keeps rendering
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry lists cc-cream
    When cc-cream runs
    Then the output is not empty
    And cc-cream exits 0

  Scenario: A corrupt registry never suppresses a possibly-live bar
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry file is corrupt
    When cc-cream runs
    Then the output is not empty
    And cc-cream exits 0

  Scenario: An orphaned cache renderer removes the stale session state file
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry file is absent
    And a state file with session "abc" having cost 5.0
    When cc-cream runs
    Then the output is empty
    And cc-cream exits 0
    And no state file is written

  Scenario: A manual/dev install (not under the plugin cache) always renders
    Given the host plugin registry file is absent
    When cc-cream runs
    Then the output is not empty
    And cc-cream exits 0
