Feature: Peak-hours environment indicator
  As a Claude Pro/Max subscriber
  I want a "peak" indicator on Row 2 during Anthropic's faster-drain window
  So that I know my 5h budget is draining faster than its percentage implies

  # PRDv2 §2. New segment `peak`, Row 2, order 3 (renders after 7d). Color: amber —
  # contextual, not an alarm. Weekday (Mon–Fri) and the America/Los_Angeles timezone
  # are HARDCODED policy facts, not config. Only the window bounds are configurable:
  # `start`/`end` are PT hours, 0–23, exclusive end; defaults start 5, end 11
  # (per-field fallback rule from v1). Hidden outside the window — no label, no
  # placeholder. Because peak lives on Row 2, an API user (no rate_limits) whose
  # Row 2 collapses also loses peak. If Intl is unavailable, hide the segment; never
  # crash (CLAUDE.md degrade rule).

  Background:
    Given stdin five_hour with used_percentage 41 resetting in 4 days
    # gives Row 2 content so the subscriber path is exercised

  Scenario: Shown during the window on a weekday
    Given the Pacific time is Monday 08:00
    When cc-cream runs
    Then row 2 ends with "peak"

  Scenario: The indicator is amber
    Given the Pacific time is Monday 08:00
    When cc-cream runs
    Then the peak segment is colored amber

  Scenario: It renders after 7d on Row 2
    Given the Pacific time is Monday 08:00
    And seven_day with used_percentage 41 resetting in 4 days
    When cc-cream runs
    Then row 2 reads "5h:41%·↺4d  7d:41%·↺4d  peak"

  Scenario: Hidden outside the window on a weekday, with no placeholder
    Given the Pacific time is Monday 12:00
    When cc-cream runs
    Then the peak segment is not rendered
    And row 2 carries no empty placeholder for peak

  Scenario: Hidden on weekends even inside the hour window
    Given the Pacific time is Saturday 08:00
    When cc-cream runs
    Then the peak segment is not rendered

  Scenario Outline: The exclusive-end boundary (default 5–11)
    Given the Pacific time is Monday <hour>
    When cc-cream runs
    Then the peak segment is <shown>

    Examples:
      | hour  | shown       |
      | 04:59 | not rendered |
      | 05:00 | rendered    |
      | 10:59 | rendered    |
      | 11:00 | not rendered |

  Scenario: The window bounds are configurable
    Given config { "segments": { "peak": { "start": 13, "end": 19 } } }
    And the Pacific time is Monday 14:00
    When cc-cream runs
    Then the peak segment is rendered
    But at Pacific time Monday 12:00 the peak segment is not rendered

  Scenario Outline: Bad bounds fall back per-field to 5 and 11
    Given config { "segments": { "peak": { "start": <start>, "end": <end> } } }
    And the Pacific time is Monday 08:00
    When cc-cream runs
    Then the peak segment is rendered

    Examples:
      | start       | end         |
      | "not-a-num" | 11          |
      | 5           | "not-a-num" |

  Scenario: Turned off via config, hidden even in-window
    Given config { "segments": { "peak": { "on": false } } }
    And the Pacific time is Monday 08:00
    When cc-cream runs
    Then the peak segment is not rendered

  Scenario: API user with no Row 2 also has no peak
    Given stdin with no rate_limits
    And the Pacific time is Monday 08:00
    When cc-cream runs
    Then only one row is emitted
    And the peak segment is not rendered

  Scenario: A timezone lookup failure hides the segment, never crashes
    Given the America/Los_Angeles timezone is unavailable
    When cc-cream runs
    Then the peak segment is not rendered
    And cc-cream exits 0
