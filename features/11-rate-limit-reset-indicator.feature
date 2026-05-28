Feature: Reset indicator on rate-limit countdowns
  As a Claude Pro/Max subscriber
  I want the reset countdown prefixed with ↺
  So that the number reads unambiguously as "time until a fresh 100%", not elapsed time

  # PRDv2 §1. Extends S7 (features/07). Only the countdown rendering changes: a ↺ glyph
  # is prepended so the meaning is "resets_at − now". Format ladder: ≥1d → "Weekday
  # HH:MM" (local time); ≥1h → HhMMm; <1h → MMm. The glyph attaches to the countdown
  # only, never to the percentage. Applies to every rate-limit window (5h and 7d).
  # ↺4d tokens below are documentation hints — step defs resolve them to Weekday HH:MM.
  # Degrade rule (CLAUDE.md): if resets_at is absent, drop the countdown — and with
  # it the glyph — but keep the percentage; never crash.

  Scenario: The 5h countdown carries the reset glyph
    Given stdin five_hour with used_percentage 67 resetting in 43m
    When cc-cream runs
    Then the 5h segment reads "5h:67%·↺43m"

  Scenario: Both windows carry the glyph
    Given the Pacific time is Monday 12:00
    And stdin five_hour with used_percentage 67 resetting in 43m
    And seven_day with used_percentage 41 resetting in 4 days
    When cc-cream runs
    Then row 2 reads "5h:67%·↺43m  7d:41%·↺4d"

  Scenario Outline: The ladder is unchanged beneath the glyph
    Given a window resetting in <remaining>
    When cc-cream runs
    Then the countdown reads "<text>"

    Examples:
      | remaining        | text   |
      | 4 days 3 hours   | ↺4d    |
      | 2 hours 14 min   | ↺2h14m |
      | 43 minutes       | ↺43m   |

  Scenario: The glyph attaches to the countdown, not the percentage
    Given stdin five_hour with used_percentage 67 resetting in 43m
    When cc-cream runs
    Then the percentage reads "67%" with no ↺ prefix
    And the ↺ glyph appears exactly once in the 5h segment

  Scenario: A window with no resets_at drops the countdown and the glyph
    Given stdin five_hour with used_percentage 67 and no resets_at
    When cc-cream runs
    Then the 5h segment reads "5h:67%"
    And the ↺ glyph is not rendered
    And cc-cream exits 0
