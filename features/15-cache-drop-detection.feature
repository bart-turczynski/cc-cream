Feature: Cache drop-detection — flag sharp last-turn cache% drop as red

  # PRD §11: when the last-turn cache% drops sharply versus the previous
  # invocation's value (prefix burn or context compaction), color the cache
  # segment red. The previous value is read from the per-session state written
  # by CREAM-kubbdyeb. Default drop threshold: 20 percentage points.
  # Configurable via segments.cache.drop in ~/.claude/cc-cream.json.

  Background:
    Given stdin whose model display_name is "claude-opus-4-7"
    And stdin with used_percentage 10 and an input-token total of 20000
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"

  Scenario: No previous state — cache segment has no color
    Given no state file exists
    And stdin current_usage with cache_read 90, cache_creation 0 and input 10
    When cc-cream runs
    Then the cache segment reads "cache:90%"
    And the cache segment has no color

  Scenario: Drop below threshold — cache segment has no color
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 80
    And stdin current_usage with cache_read 65, cache_creation 0 and input 35
    When cc-cream runs
    Then the cache segment reads "cache:65%"
    And the cache segment has no color

  Scenario: Drop exactly at threshold — cache segment turns red
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 80
    And stdin current_usage with cache_read 60, cache_creation 0 and input 40
    When cc-cream runs
    Then the cache segment reads "cache:60%"
    And the cache segment is colored red

  Scenario: Sharp drop — cache segment turns red
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 95
    And stdin current_usage with cache_read 10, cache_creation 0 and input 90
    When cc-cream runs
    Then the cache segment reads "cache:10%"
    And the cache segment is colored red

  Scenario: No drop — cache segment has no color
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 90
    And stdin current_usage with cache_read 90, cache_creation 0 and input 10
    When cc-cream runs
    Then the cache segment reads "cache:90%"
    And the cache segment has no color

  Scenario: Configurable threshold — smaller threshold fires on a smaller drop
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 80
    And stdin current_usage with cache_read 70, cache_creation 0 and input 30
    And config {"segments":{"cache":{"drop":10}}}
    When cc-cream runs
    Then the cache segment is colored red

  Scenario: Recovery mode — red persists while below recover threshold
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 60 and recovering
    And stdin current_usage with cache_read 65, cache_creation 0 and input 35
    When cc-cream runs
    Then the cache segment is colored red

  Scenario: Recovery mode — gray when cache reaches recover threshold
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 75 and recovering
    And stdin current_usage with cache_read 80, cache_creation 0 and input 20
    When cc-cream runs
    Then the cache segment has no color

  Scenario: Configurable recover threshold
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cache_pct 60 and recovering
    And stdin current_usage with cache_read 70, cache_creation 0 and input 30
    And config {"segments":{"cache":{"drop_recover":65}}}
    When cc-cream runs
    Then the cache segment has no color

  Scenario: No session_id in stdin — cache segment has no color
    Given no state file exists
    And no session_id in stdin
    And stdin current_usage with cache_read 10, cache_creation 0 and input 90
    When cc-cream runs
    Then the cache segment reads "cache:10%"
    And the cache segment has no color
