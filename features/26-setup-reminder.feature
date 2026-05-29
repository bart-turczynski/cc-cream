Feature: Setup reminder hook (CREAM-cpcwjkxi)
  As a user who just installed the cc-cream plugin
  I want a nudge to run /cc-cream:setup while the bar isn't wired
  So that I'm not left wondering why no status bar appeared

  # Claude Code can't write the statusLine into settings.json when a plugin is
  # installed (no install hook), so the bar only appears after the explicit
  # /cc-cream:setup step. A SessionStart hook (hooks/hooks.json, auto-discovered
  # like the official ralph-loop plugin) runs hooks/setup-reminder.js, which emits
  # a `systemMessage` — shown to the user, NOT added to the model context (zero
  # tokens) — but only while cc-cream's statusLine is absent, so it self-silences
  # once setup runs. Degrade, never crash: always exit 0.

  Scenario: The plugin registers a SessionStart hook for the reminder
    Then hooks/hooks.json exists and registers a SessionStart command hook
    And the hook command runs hooks/setup-reminder.js via ${CLAUDE_PLUGIN_ROOT}

  Scenario: The reminder nudges to run setup on a fresh machine
    Given there is no settings.json on disk
    When the setup-reminder hook runs
    Then it prints a systemMessage telling the user to run /cc-cream:setup
    And the reminder adds nothing to the model context
    And the reminder exits zero

  Scenario: The reminder nudges when only a foreign statusLine is present
    Given settings.json on disk has a foreign statusLine
    When the setup-reminder hook runs
    Then it prints a systemMessage telling the user to run /cc-cream:setup
    And the reminder exits zero

  Scenario: The reminder stays silent once cc-cream is wired
    Given settings.json on disk has cc-cream's statusLine and a state file
    When the setup-reminder hook runs
    Then it prints nothing
    And the reminder exits zero

  Scenario: The reminder stays silent on a malformed settings.json
    Given settings.json on disk is not valid JSON
    When the setup-reminder hook runs
    Then it prints nothing
    And the reminder exits zero
