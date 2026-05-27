Feature: Cache segment — last-turn hit rate
  As a Claude Code user
  I want cache:NN% from the most recent API response
  So that I can see how much of the last turn was served from cache

  # PRD §4.1, §4.4. Neutral in v1 — no color (drop-detection red is a v2 item).
  # Source: context_window.current_usage.{cache_read_input_tokens,
  # cache_creation_input_tokens, input_tokens}.

  Scenario: Computes read / (read + creation + input)
    Given stdin current_usage with cache_read 950000, cache_creation 30000 and input 20000
    When cc-cream runs
    Then the cache segment reads "cache:95%"
    And the cache segment has no color

  Scenario: Hidden right after /compact when current_usage is null
    Given stdin with current_usage set to null
    When cc-cream runs
    Then the cache segment is not rendered
    And cc-cream exits 0

  Scenario: Hidden when the denominator is zero
    Given stdin current_usage with cache_read 0, cache_creation 0 and input 0
    When cc-cream runs
    Then the cache segment is not rendered
