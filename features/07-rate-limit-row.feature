Feature: Rate-limit windows and the adaptive second row
  As a Claude Pro/Max subscriber
  I want 5h and 7d windows with reset countdowns on a second row
  So that I get early warning before I am throttled

  # PRD §4.1, §4.4, §5. Bands follow the §6 convention (lower bound where it begins,
  # red tested first) with defaults amber:75, red:90. Countdown always shown.
  # Row 2 renders only if it has content, so API users (no rate_limits) get one row.

  Scenario: Subscriber gets two rows
    Given stdin five_hour with used_percentage 23 resetting in 2h14m
    And seven_day with used_percentage 41 resetting in 4 days
    When cc-cream runs
    Then row 2 reads "5h:23%·2h14m  7d:41%·4d"

  Scenario: API user with no rate_limits collapses to a single row
    Given stdin with no rate_limits
    When cc-cream runs
    Then only one row is emitted

  Scenario: One window absent hides only that segment
    Given stdin with five_hour present and seven_day absent
    When cc-cream runs
    Then row 2 shows the 5h segment and omits the 7d segment

  Scenario Outline: Reset-countdown format ladder
    Given a window resetting in <remaining>
    When cc-cream runs
    Then the countdown reads "<text>"

    Examples:
      | remaining        | text  |
      | 4 days 3 hours   | 4d    |
      | 2 hours 14 min   | 2h14m |
      | 43 minutes       | 43m   |

  Scenario Outline: Color bands (defaults amber:75, red:90)
    Given a window at used_percentage <pct>
    When cc-cream runs
    Then the segment is colored <color>

    Examples:
      | pct | color   |
      | 50  | neutral |
      | 74  | neutral |
      | 75  | amber   |
      | 89  | amber   |
      | 90  | red     |
