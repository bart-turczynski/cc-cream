Feature: Setup command bakes the current version's absolute path (CREAM-kpsjregt, CREAM-wfimkpqu)
  As a marketplace user
  I want the setup command to wire a statusLine the SessionStart hook keeps fresh
  So that running /plugin update applies a new version with no further steps

  # Option C (CREAM-wfimkpqu): ${CLAUDE_PLUGIN_ROOT} does NOT expand in the
  # statusLine command context, so the command can't resolve the plugin version
  # at render time. Instead the command bakes the current version's ABSOLUTE
  # cc-cream.js path, and the SessionStart hook (which DOES get
  # ${CLAUDE_PLUGIN_ROOT}) re-pins it after a /plugin update. This deletes the old
  # cache-glob (ls | grep | sort -V | tail) entirely — no shell version logic, no
  # GNU `sort -V` dependency. Both install modes share one command shape; only the
  # entrypoint differs (plugin cache vs the copied home runtime). A `[ -f … ]`
  # guard degrades to a silent exit 0 if the entrypoint is gone.

  Scenario: The plugin setup bakes the current version's absolute entrypoint
    Given the plugin is installed in the Claude Code plugin cache
    When the setup command runs in plugin mode and I consent
    Then settings.json gains a statusLine of type "command" with refreshInterval 60
    And the command runs the current version's cc-cream.js by its absolute path
    And the command does not glob the plugin cache
    And the command guards a missing entrypoint with a silent exit
    And it invokes node by its absolute path, not a bare "node" on PATH

  Scenario: The setup command is a thin wrapper over install.js
    Then commands/setup.md exists and registers as the /cc-cream:setup command
    And it invokes src/install.js in plugin mode rather than writing settings.json itself
    And it shows a brief one-line note, not a verbose body

  Scenario: An existing statusLine is still confirmed before replacing
    Given settings.json already has a statusLine command
    When the setup command runs
    Then it shows the existing line and asks before replacing it
    And declining leaves the existing statusLine unchanged

  Scenario: The manual path still copies runtime files into the home directory
    Given a local checkout with no plugin cache
    When install.js runs without plugin mode and I consent
    Then it copies the runtime into the home cc-cream directory
    And it points the statusLine command at that copied entrypoint

  # If a user runs `/plugin uninstall cc-cream` without first running
  # /cc-cream:uninstall, the baked absolute path outlives the deleted plugin cache.
  # The `[ -f … ] || exit 0` guard MUST degrade to a silent exit 0, not crash with
  # MODULE_NOT_FOUND on a now-missing entrypoint every render.
  Scenario: An orphaned statusLine degrades silently when the entrypoint is gone
    Given the statusLine command points at a missing entrypoint
    When the orphaned status line command runs
    Then it prints nothing and exits zero

  Scenario: The engine makes no network call on render
    Given the downloaded cc-cream.js
    When Claude Code pipes it a session JSON on stdin
    Then it prints the formatted bar to stdout without any network access
