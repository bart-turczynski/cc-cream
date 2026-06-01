Feature: Peak-hours environment indicator
  As a Claude Pro/Max subscriber
  I want a "peak" indicator on Row 2 during Anthropic's faster-drain window
  So that I know my 5h budget is draining faster than its percentage implies,
  when the window closes, and when the next one is about to open

  # PRDv2 §2 (+ CREAM-scwwzbxh). Segment `peak`, Row 2, order 3 (renders after 7d).
  # Color: amber — contextual, not an alarm. Weekday (Mon–Fri) and the
  # America/Los_Angeles timezone are HARDCODED policy facts, not config. Configurable:
  # `start`/`end` are PT hours, 0–23, exclusive end (defaults 5/11); `lead` is how many
  # minutes before `start` the approaching countdown appears (default 60). All
  # per-field fallback (v1 rule). Two render states:
  #   - inside [start, end):              "peak until HH:MM" — HH:MM is the window
  #                                       close in the user's LOCAL time (TZ-driven).
  #   - inside [start-lead, start):       "peak in Nm"       — minutes until it opens.
  # Hidden otherwise — no label, no placeholder. Because peak lives on Row 2, an API
  # user (no rate_limits) whose Row 2 collapses also loses peak. If Intl is
  # unavailable, hide the segment; never crash (CLAUDE.md degrade rule).

  Background:
    Given stdin five_hour with used_percentage 41 resetting in 4 days
    # gives Row 2 content so the subscriber path is exercised

  Scenario: Inside the window, peak shows the local close time
    Given the Pacific time is Monday 08:00
    And the local timezone is "America/Los_Angeles"
    When cc-cream runs
    Then row 2 ends with "peak until 11:00"

  Scenario: The close time is shown in the user's local timezone, not PT
    Given the Pacific time is Monday 08:00
    And the local timezone is "America/New_York"
    When cc-cream runs
    # 11:00 PT close == 14:00 ET for an East-coast user
    Then row 2 ends with "peak until 14:00"

  Scenario: The indicator is amber
    Given the Pacific time is Monday 08:00
    When cc-cream runs
    Then the peak segment is colored amber

  Scenario: It renders after 7d on Row 2
    # Sub-day resets keep the reset string timezone-independent, so pinning the
    # local zone for the "peak until" close time doesn't disturb the ↺ countdown.
    Given stdin five_hour with used_percentage 41 resetting in 2 hours
    And the Pacific time is Monday 08:00
    And the local timezone is "America/Los_Angeles"
    And seven_day with used_percentage 41 resetting in 2 hours
    When cc-cream runs
    Then row 2 reads "5h:41% ↺ 2h00m | 7d:41% ↺ 2h00m | peak until 11:00"

  Scenario: Approaching the window, peak counts down in minutes
    Given the Pacific time is Monday 04:30
    When cc-cream runs
    Then row 2 ends with "peak in 30m"

  Scenario: The approaching countdown is amber too
    Given the Pacific time is Monday 04:30
    When cc-cream runs
    Then the peak segment is colored amber

  Scenario: Hidden outside the window on a weekday, with no placeholder
    Given the Pacific time is Monday 12:00
    When cc-cream runs
    Then the peak segment is not rendered
    And row 2 carries no empty placeholder for peak

  Scenario: Hidden on weekends even inside the hour window
    Given the Pacific time is Saturday 08:00
    When cc-cream runs
    Then the peak segment is not rendered

  Scenario Outline: The window and lead edges (default lead 60, window 5–11)
    Given the Pacific time is Monday <time>
    And the local timezone is "America/Los_Angeles"
    When cc-cream runs
    Then row 2 ends with "<peak>"

    Examples:
      | time  | peak             |
      | 04:00 | peak in 60m      |
      | 04:59 | peak in 1m       |
      | 05:00 | peak until 11:00 |
      | 10:59 | peak until 11:00 |

  Scenario Outline: Hidden before the lead window opens and after the window closes
    Given the Pacific time is Monday <time>
    When cc-cream runs
    Then the peak segment is not rendered

    Examples:
      | time  |
      | 03:59 |
      | 11:00 |
      | 12:00 |

  Scenario: The window bounds are configurable
    Given config { "segments": { "peak": { "start": 13, "end": 19 } } }
    And the Pacific time is Monday 14:00
    When cc-cream runs
    Then the peak segment is rendered
    But at Pacific time Monday 11:00 the peak segment is not rendered

  Scenario: The lead window is configurable
    Given config { "segments": { "peak": { "start": 13, "end": 19, "lead": 30 } } }
    And the Pacific time is Monday 12:45
    When cc-cream runs
    Then row 2 ends with "peak in 15m"
    But at Pacific time Monday 12:15 the peak segment is not rendered

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
