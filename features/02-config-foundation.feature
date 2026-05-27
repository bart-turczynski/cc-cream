Feature: Data-driven configuration with per-field fallback
  As a power user
  I want every display decision read from ~/.claude/cc-cream.json with safe fallback
  So that I can retune the bar by hand and a typo degrades one value, never the whole bar

  # PRD §6, §14.2. Establishes the data-driven renderer; here it drives the model
  # segment's on/row/order. Decision §14.2: "width" is dropped from the schema;
  # the global keys are "numbers" and "ttl". The 80-col target stays as design intent.

  Scenario: Defaults apply when no config file exists
    Given no file at "~/.claude/cc-cream.json"
    And stdin whose model display_name is "Opus 4.7 (1M context)"
    When cc-cream runs
    Then the model segment renders with its built-in defaults (on, row 1, order 1)

  Scenario: A segment can be turned off
    Given config:
      """
      { "segments": { "model": { "on": false } } }
      """
    And stdin whose model display_name is "Opus 4.7 (1M context)"
    When cc-cream runs
    Then the model segment is not rendered

  Scenario: A single malformed field falls back to its own default, leaving the rest intact
    Given config:
      """
      { "segments": { "model": { "on": true, "order": "not-a-number" } } }
      """
    And stdin whose model display_name is "Opus 4.7 (1M context)"
    When cc-cream runs
    Then the model segment renders at its default order
    And cc-cream exits 0

  Scenario: A whole-file parse failure falls back to all defaults
    Given config with a trailing comma:
      """
      { "numbers": "compact", }
      """
    And stdin whose model display_name is "Opus 4.7 (1M context)"
    When cc-cream runs
    Then the entire bar renders with built-in defaults
    And cc-cream exits 0

  Scenario Outline: Global keys fall back independently
    Given config { "<key>": "<bad>" }
    When cc-cream runs
    Then "<key>" falls back to "<default>"

    Examples:
      | key     | bad   | default |
      | numbers | bogus | compact |
      | ttl     | bogus | auto    |
