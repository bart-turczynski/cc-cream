Feature: Additional stdin fields — session_name and cache write (CREAM-nchmlpmq)
  As a user
  I want to see the session name and cache-creation percentage
  So that I can identify sessions at a glance and monitor cache write activity

  # Both segments are off by default.

  Background:
    Given stdin with no rate_limits

  # ---------------------------------------------------------------------------
  # session_name segment
  # ---------------------------------------------------------------------------

  Scenario: session_name segment is off by default
    Given default config
    And stdin with session_name "my-project-session"
    When cc-cream runs
    Then the session_name segment is not rendered

  Scenario: session_name shows the conversation name when enabled
    Given config {"segments":{"session_name":{"on":true}}}
    And stdin with session_name "my-project-session"
    When cc-cream runs
    Then the session_name segment reads "session:my-project-session"

  Scenario: session_name is hidden when absent in stdin
    Given config {"segments":{"session_name":{"on":true}}}
    And stdin with no session_name field
    When cc-cream runs
    Then the session_name segment is not rendered

  Scenario: session_name is hidden when it is an empty string
    Given config {"segments":{"session_name":{"on":true}}}
    And stdin with session_name ""
    When cc-cream runs
    Then the session_name segment is not rendered

  Scenario: session_name appears before model in row 1 zone 1
    Given config {"segments":{"session_name":{"on":true}}}
    And stdin with session_name "work"
    And stdin whose model display_name is "Sonnet 4.6"
    When cc-cream runs
    Then row 1 zone 1 reads "session:work Sonnet 4.6"

  Scenario: session_name is in zone 1 (separated from ctx by the zone pipe)
    Given config {"segments":{"session_name":{"on":true}}}
    And stdin with session_name "alpha"
    And stdin whose model display_name is "Sonnet 4.6"
    And stdin with used_percentage 10
    When cc-cream runs
    Then row 1 zone 1 reads "session:alpha Sonnet 4.6"
    And row 1 includes " | " between zone 1 and zone 2

  # ---------------------------------------------------------------------------
  # write (cache creation %) segment
  # ---------------------------------------------------------------------------

  Scenario: write segment is off by default
    Given default config
    And stdin current_usage with cache_read 100, cache_creation 50 and input 50
    When cc-cream runs
    Then the write segment is not rendered

  Scenario: write segment shows cache_creation as percent of total tokens
    Given config {"segments":{"write":{"on":true}}}
    And stdin current_usage with cache_read 100, cache_creation 50 and input 50
    When cc-cream runs
    Then the write segment reads "write:25%"

  Scenario: write is 100% when only cache_creation is present
    Given config {"segments":{"write":{"on":true}}}
    And stdin current_usage with cache_read 0, cache_creation 200 and input 0
    When cc-cream runs
    Then the write segment reads "write:100%"

  Scenario: write is hidden when current_usage is absent
    Given config {"segments":{"write":{"on":true}}}
    And stdin with no context_window
    When cc-cream runs
    Then the write segment is not rendered

  Scenario: write is hidden when current_usage is null (post-compact)
    Given config {"segments":{"write":{"on":true}}}
    And stdin with current_usage set to null
    When cc-cream runs
    Then the write segment is not rendered

  Scenario: write is hidden when all token counts are zero
    Given config {"segments":{"write":{"on":true}}}
    And stdin current_usage with cache_read 0, cache_creation 0 and input 0
    When cc-cream runs
    Then the write segment is not rendered

  Scenario: write appears between cache and idle in zone 2
    Given config {"segments":{"write":{"on":true}}}
    And stdin current_usage with cache_read 900, cache_creation 100 and input 0
    And the transcript was just appended, so its mtime is now
    When cc-cream runs
    Then row 1 includes "cache:90%" before "write:10%"
    And row 1 includes "write:10%" before "ttl:"
