Feature: Verify the Claude Code stdin contract and capture a golden fixture
  As the cc-cream developer
  I want the real stdin field names and shapes confirmed against a live session
  So that every downstream segment is built on verified fields, not assumptions

  # Gating spike (PRD §10, §12, §14.4). Decision §14.4: this is the FIRST story;
  # nothing that depends on an unverified field name is built until it closes.
  # Decision §14.3: capture from a live SUBSCRIPTION session; API-user sampling
  # is a separate later ticket, not a v1 priority.

  Scenario: A golden subscriber fixture is captured from a live session
    Given a live Claude Code subscription session on a 1M-context model
    When the configured statusLine command receives its stdin
    Then the raw stdin JSON is saved to "fixtures/subscriber.golden.json"

  Scenario: The golden fixture carries every field the default segments read
    Given the golden fixture "fixtures/subscriber.golden.json"
    Then it has a string at "model.display_name"
    And it has a number at "context_window.used_percentage"
    And it has numbers under "context_window.current_usage" for cache_read_input_tokens, cache_creation_input_tokens and input_tokens
    And it has a number at "cost.total_cost_usd"
    And it has a filesystem path at "transcript_path"
    And it has "used_percentage" and "resets_at" under both "rate_limits.five_hour" and "rate_limits.seven_day"

  Scenario: The unconfirmed context-magnitude field is resolved
    Given the golden fixture "fixtures/subscriber.golden.json"
    Then the field backing the ctx magnitude is identified by its real name (PRD §4.1 assumed "total_input_tokens")
    And its basis is confirmed input-only — input + cache_creation + cache_read — matching used_percentage (PRD §10)

  Scenario: The used_percentage denominator is confirmed for a 200k-window model
    Given a session on a 200k-context model
    Then used_percentage is confirmed to track input-tokens divided by 200000
    And the §12 open question about the denominator is closed
