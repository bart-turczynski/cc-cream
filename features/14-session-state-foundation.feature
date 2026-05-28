Feature: Per-session state foundation — session_id-keyed state file

  # Prerequisite for CREAM-ilbfufzj (cache-drop), CREAM-omnrerei (cost-delta), and
  # CREAM-liajfxab (burn-rate). On each invocation cc-cream reads
  # ~/.claude/cc-cream-state.json, looks up the current session_id, and writes back
  # updated state. Any I/O or JSON error degrades to stateless behaviour — the bar
  # must never crash because of a missing or corrupt state file.

  Background:
    Given stdin whose model display_name is "claude-opus-4-7"
    And stdin with used_percentage 10 and an input-token total of 20000
    And a session_id of "aabbccdd-0000-0000-0000-000000000001"

  # ---- graceful degradation -------------------------------------------------

  Scenario: Missing state file — bar renders normally
    Given no state file exists
    When cc-cream runs
    Then cc-cream exits 0
    And the output is not empty

  Scenario: Corrupted state file — bar renders normally
    Given a corrupted state file
    When cc-cream runs
    Then cc-cream exits 0
    And the output is not empty

  Scenario: No session_id in stdin — bar renders normally and no state file is written
    Given no session_id in stdin
    When cc-cream runs
    Then cc-cream exits 0
    And the output is not empty
    And no state file is written

  # ---- state persistence ----------------------------------------------------

  Scenario: State file is created and populated on the first run
    Given no state file exists
    And stdin with total_cost_usd 3.50
    When cc-cream runs
    Then a state file is written
    And the state for session "aabbccdd-0000-0000-0000-000000000001" has cost 3.50

  Scenario: State is updated on a second run
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cost 2.00
    And stdin with total_cost_usd 4.25
    When cc-cream runs
    Then the state for session "aabbccdd-0000-0000-0000-000000000001" has cost 4.25

  Scenario: Sessions with different IDs are stored independently
    Given a state file with session "aabbccdd-0000-0000-0000-000000000001" having cost 1.00
    And a session_id of "eeffgghh-0000-0000-0000-000000000002"
    And stdin with total_cost_usd 5.00
    When cc-cream runs
    Then the state for session "aabbccdd-0000-0000-0000-000000000001" has cost 1.00
    And the state for session "eeffgghh-0000-0000-0000-000000000002" has cost 5.00
