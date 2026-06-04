Feature: Token count segments — tokens_in and tokens_out
  As a user who wants to see raw token throughput
  I want dedicated segments for input and output token counts
  So that I can monitor turn size independently of cache percentages

  # tokens_in uses total_input_tokens (all three input components combined).
  # tokens_out uses current_usage.output_tokens. Both use fmtNum for formatting.

  Scenario: tokens_in shows total input tokens in compact format
    Given default config
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 includes "in:30k"

  Scenario: tokens_out shows output tokens in compact format
    Given default config
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 includes "out:452"

  Scenario: tokens_in respects numbers:exact config
    Given config {"numbers":"exact"}
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 includes "in:29578"

  Scenario: tokens_out respects numbers:exact config
    Given config {"numbers":"exact"}
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 includes "out:452"

  Scenario: tokens_in is hidden when turned off
    Given config {"segments":{"tokens_in":{"on":false}}}
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 does not include "in:"

  Scenario: tokens_out is hidden when turned off
    Given config {"segments":{"tokens_out":{"on":false}}}
    And a subscriber stdin fixture
    When cc-cream runs
    Then row 1 does not include "out:"

  Scenario: tokens_in absent when no usage data in stdin
    Given default config
    And stdin with no context_window
    When cc-cream runs
    Then the output does not include "in:"

  Scenario: tokens_out absent when no usage data in stdin
    Given default config
    And stdin with no context_window
    When cc-cream runs
    Then the output does not include "out:"
