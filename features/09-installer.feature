Feature: Consent-based installer for the statusLine command
  As a new cc-cream user
  I want a guided edit that wires cc-cream into my settings.json with my consent
  So that the bar appears without hand-editing JSON and nothing is overwritten silently

  # PRD §7, §14.1. v1 ships the raw-.js channel (npm + plugin deferred, §14.1).
  # Writes "statusLine": { "type": "command", "command": "<path>", "refreshInterval": 60 }.

  Scenario: Fresh install writes the statusLine block after showing the change
    Given settings.json has no statusLine
    When the installer runs and I consent
    Then settings.json gains a statusLine of type "command" with refreshInterval 60
    And its command points at the cc-cream entrypoint

  Scenario: An existing statusLine is detected and confirmed before replacing
    Given settings.json already has a statusLine command
    When the installer runs
    Then it shows the existing line and asks before replacing it
    And declining leaves the existing statusLine unchanged

  Scenario: User padding is preserved
    Given settings.json sets statusLine.padding
    When the installer runs and I consent
    Then the padding value is preserved, since it shrinks the 80-col budget

  Scenario: Idempotent — re-running makes no further change
    Given cc-cream is already installed
    When the installer runs again
    Then settings.json is unchanged

  Scenario: The trust and restart requirement is surfaced
    When the installer completes
    Then it states that Claude Code must be trusted and possibly restarted for the bar to appear

  Scenario: Uninstall removes only a cc-cream statusLine
    Given cc-cream is already installed
    When the uninstaller runs
    Then settings.json no longer has a statusLine

  Scenario: Uninstall leaves a foreign statusLine untouched
    Given settings.json already has a statusLine command
    When the uninstaller runs
    Then the existing statusLine is left unchanged

  Scenario: Uninstall preserves the user's other settings
    Given settings.json has cc-cream installed alongside other keys
    When the uninstaller runs
    Then settings.json no longer has a statusLine
    And the other settings keys are preserved

  Scenario: A malformed settings.json is never overwritten
    Given settings.json on disk is not valid JSON
    When install.js runs against it
    Then it exits non-zero and leaves the file byte-for-byte unchanged
