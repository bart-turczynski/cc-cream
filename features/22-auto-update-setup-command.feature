Feature: Auto-updating setup command for plugin installs (CREAM-kpsjregt)
  As a marketplace user
  I want the setup command to wire a self-resolving statusLine
  So that running /plugin update applies a new version with no further steps

  # docs/RELEASE_PLAN.md Phase 2. The command written to settings.json must not
  # hardcode a versioned path: it globs the plugin cache and selects the highest
  # installed version on every render (the claude-hud pattern). The existing
  # tested install.js behavior — consent-to-replace, padding preservation,
  # refreshInterval 60, trust/restart notice — is retained. Copy-to-home demotes
  # to the documented manual/GitHub path. The selection must consider only
  # semver-named dirs (CREAM-kxwhbwzq): a git-sha cache dir like c83650b6360f sorts
  # after every 0.1.x under `sort -V` and would otherwise pin the bar to whatever
  # version that dir holds, silently defeating auto-update.

  Scenario: The plugin setup writes a cache-glob auto-update command
    Given the plugin is installed in the Claude Code plugin cache
    When the setup command runs in plugin mode and I consent
    Then settings.json gains a statusLine of type "command" with refreshInterval 60
    And the command globs the plugin cache for cc-cream and selects the highest version with "sort -V"
    And the command only considers semver-named version dirs
    And the command appends "src/cc-cream.js" to the resolved version directory
    And it invokes node by its absolute path, not a bare "node" on PATH

  Scenario: A newer cached version is picked up without re-running setup
    Given the statusLine uses the cache-glob command
    And a newer cc-cream version directory appears in the plugin cache
    When Claude Code next renders the status line
    Then it runs the newer version without any change to settings.json

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

  Scenario: The engine makes no network call on render
    Given the downloaded cc-cream.js
    When Claude Code pipes it a session JSON on stdin
    Then it prints the formatted bar to stdout without any network access
