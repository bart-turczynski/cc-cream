Feature: Auto-wire the status bar on first session (CREAM-nywsljfq)
  As a user who just installed the cc-cream plugin
  I want the status bar to turn itself on without a manual setup step
  So that install + reload is all I need

  # Claude Code can't contribute the main statusLine from a plugin (only the
  # agent/subagentStatusLine keys are plugin-settable — verified), so the bar still
  # needs a write to ~/.claude/settings.json. A SessionStart hook
  # (hooks/auto-setup.js, auto-discovered like ralph-loop) does that on the FIRST
  # session after install — but only when the statusLine slot is FREE. It never
  # clobbers a line set for something else (that routes through interactive
  # /cc-cream:setup), and a one-shot marker means it never re-wires a bar the user
  # later removed with /cc-cream:uninstall. Output is a single systemMessage:
  # user-facing, zero model tokens. Degrade, never crash; always exit 0.

  Scenario: The plugin registers a SessionStart hook for auto-setup
    Then hooks/hooks.json exists and registers a SessionStart command hook
    And the hook command runs hooks/auto-setup.js via ${CLAUDE_PLUGIN_ROOT}

  Scenario: First session with no status line auto-wires cc-cream's bar
    Given there is no settings.json on disk
    When the session-start hook runs
    Then it writes cc-cream's statusLine into settings.json
    And it announces that the status bar was enabled
    And the reminder adds nothing to the model context
    And the reminder exits zero

  Scenario: A foreign status line is never clobbered
    Given settings.json on disk has a foreign statusLine
    When the session-start hook runs
    Then it leaves the foreign statusLine unchanged
    And it prints a systemMessage telling the user to run /cc-cream:setup
    And the reminder exits zero

  Scenario: An existing cc-cream status line is left alone
    Given settings.json on disk has cc-cream's statusLine and a state file
    When the session-start hook runs
    Then it changes nothing and prints nothing
    And the reminder exits zero

  # Keep-fresh (Option C, CREAM-wfimkpqu): ${CLAUDE_PLUGIN_ROOT} can't expand in
  # the statusLine command, so the hook bakes the current version's absolute path
  # and re-pins it every session. After a /plugin update the old version path is
  # rewritten to the new one — silently, since it's our own line, not a new bar.
  Scenario: An out-of-date cc-cream status line is re-pinned to the current version
    Given settings.json on disk has an out-of-date cc-cream statusLine
    When the session-start hook runs
    Then it re-pins the statusLine to the current entrypoint
    And it makes the change without announcing
    And the reminder exits zero

  Scenario: It never re-wires a bar the user has removed
    Given cc-cream has already auto-set-up once
    And there is no settings.json on disk
    When the session-start hook runs
    Then it changes nothing and prints nothing
    And the reminder exits zero

  Scenario: A malformed settings.json is left untouched
    Given settings.json on disk is not valid JSON
    When the session-start hook runs
    Then it changes nothing and prints nothing
    And the reminder exits zero
