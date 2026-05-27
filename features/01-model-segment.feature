Feature: Render the model segment from stdin
  As a Claude Code user
  I want cc-cream to read the session JSON that Claude Code pipes to it on stdin
  and print the model name
  So that the status line is a working end-to-end command before any other
  segment exists

  # Walking skeleton. Establishes the stdin -> stdout contract and the
  # "degrade, never crash" rule (PRD §6, §14.3) with the single simplest
  # segment (PRD §4.1, Model row). No color, no config yet.

  Scenario: The model display name is rendered
    Given Claude Code pipes cc-cream this stdin:
      """
      { "model": { "display_name": "Opus 4.7 (1M context)" } }
      """
    When cc-cream runs
    Then cc-cream exits 0
    And the output is exactly:
      """
      Opus 4.7 (1M context)
      """

  Scenario: Missing model field hides the segment instead of erroring
    Given Claude Code pipes cc-cream this stdin:
      """
      {}
      """
    When cc-cream runs
    Then cc-cream exits 0
    And the output is empty

  Scenario: Malformed stdin degrades, never crashes
    Given Claude Code pipes cc-cream this stdin:
      """
      not valid json {
      """
    When cc-cream runs
    Then cc-cream exits 0
    And the output is empty
