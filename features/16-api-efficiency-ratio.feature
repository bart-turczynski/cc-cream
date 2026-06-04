Feature: API efficiency ratio segment (CREAM-ubhwyadt)
  As a user
  I want to see what fraction of wall time was spent waiting on API calls
  So that I can distinguish network-bound from compute-bound sessions

  # On by default — can be disabled via config.

  Background:
    Given stdin with no rate_limits

  Scenario: api_ratio segment renders by default when data is available
    Given default config
    And stdin with total_api_duration_ms 3000 and total_duration_ms 5000
    When cc-cream runs
    Then the api_ratio segment reads "∿ api:60%"

  Scenario: api_ratio shows the percentage of wall time in API calls
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with total_api_duration_ms 3000 and total_duration_ms 5000
    When cc-cream runs
    Then the api_ratio segment reads "∿ api:60%"

  Scenario: api_ratio rounds the ratio to the nearest percent
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with total_api_duration_ms 1 and total_duration_ms 3
    When cc-cream runs
    Then the api_ratio segment reads "∿ api:33%"

  Scenario: api_ratio is 100% when api equals total
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with total_api_duration_ms 5000 and total_duration_ms 5000
    When cc-cream runs
    Then the api_ratio segment reads "∿ api:100%"

  Scenario: api_ratio is hidden when cost fields are absent
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with no cost field
    When cc-cream runs
    Then the api_ratio segment is not rendered

  Scenario: api_ratio is hidden when total_duration_ms is zero
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with total_api_duration_ms 0 and total_duration_ms 0
    When cc-cream runs
    Then the api_ratio segment is not rendered

  Scenario: api_ratio is hidden when api_duration_ms is absent but total_duration_ms is present
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with only total_duration_ms 5000
    When cc-cream runs
    Then the api_ratio segment is not rendered

  Scenario: api_ratio clamps to 100% when api exceeds total
    Given config {"segments":{"api_ratio":{"on":true}}}
    And stdin with total_api_duration_ms 6000 and total_duration_ms 5000
    When cc-cream runs
    Then the api_ratio segment reads "∿ api:100%"

  Scenario: api_ratio appears in row 1 zone 2 after thinking when both are on
    Given config {"segments":{"api_ratio":{"on":true},"thinking":{"on":true}}}
    And stdin with total_api_duration_ms 2000 and total_duration_ms 4000
    And stdin with thinking.enabled true
    When cc-cream runs
    Then row 1 includes "think:on" before "∿ api:50%"
