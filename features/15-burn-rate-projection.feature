Feature: Burn-rate projection — time-to-cap estimate on Row 2
  As a Claude subscriber
  I want to see how long before my 5h budget runs out at the current pace
  So I can slow down before hitting throttling

  # PRDv2 §11. Reads the stored (ts, five_hour_pct) from the previous invocation for
  # this session_id, computes velocity, and shows "~Nm" or "~NhMm" on Row 2 between
  # the 5h and 7d segments. Hidden on first run, window reset (pct dropped), zero
  # consumption, or absent rate-limit data. Config key: segments.burn (on by default).
  # Depends on S14 (per-session state foundation).

  Scenario: Projection shown when velocity is measurable
    Given the Pacific time is Monday 12:00
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And a state file with session "aabbccdd-0000-0000-0000-000000000001" having five_hour_pct 20 sampled 30m ago
    And stdin five_hour with used_percentage 50 resetting in 2h30m
    When cc-cream runs
    Then row 2 includes "~50m"

  Scenario: Hours-and-minutes format for longer ETAs
    Given the Pacific time is Monday 12:00
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And a state file with session "aabbccdd-0000-0000-0000-000000000001" having five_hour_pct 10 sampled 30m ago
    And stdin five_hour with used_percentage 20 resetting in 4h
    When cc-cream runs
    Then row 2 includes "~4h00m"

  Scenario: No projection on first invocation — no prior state
    Given the Pacific time is Monday 12:00
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And no state file exists
    And stdin five_hour with used_percentage 50 resetting in 2h30m
    When cc-cream runs
    Then row 2 does not include a burn projection

  Scenario: Projection hidden when window reset — usage went down
    Given the Pacific time is Monday 12:00
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And a state file with session "aabbccdd-0000-0000-0000-000000000001" having five_hour_pct 80 sampled 30m ago
    And stdin five_hour with used_percentage 5 resetting in 4h50m
    When cc-cream runs
    Then row 2 does not include a burn projection

  Scenario: Turned off via config
    Given the Pacific time is Monday 12:00
    And config { "segments": { "burn": { "on": false } } }
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And a state file with session "aabbccdd-0000-0000-0000-000000000001" having five_hour_pct 20 sampled 30m ago
    And stdin five_hour with used_percentage 50 resetting in 2h30m
    When cc-cream runs
    Then row 2 does not include a burn projection

  Scenario: Projection hidden when ETA exceeds the 5h window duration
    # Slow burn (1pp/30min) → ETA ~35h — window resets first; not actionable.
    Given the Pacific time is Monday 12:00
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And a state file with session "aabbccdd-0000-0000-0000-000000000001" having five_hour_pct 28 sampled 30m ago
    And stdin five_hour with used_percentage 29 resetting in 34m
    When cc-cream runs
    Then row 2 does not include a burn projection

  Scenario: five_hour_pct persisted to state for next run
    Given a session_id of "aabbccdd-0000-0000-0000-000000000001"
    And no state file exists
    And stdin five_hour with used_percentage 35 resetting in 3h
    When cc-cream runs
    Then the state for session "aabbccdd-0000-0000-0000-000000000001" has five_hour_pct 35
