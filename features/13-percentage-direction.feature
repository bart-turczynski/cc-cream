Feature: Percentage direction — consumed vs. remaining
  As a user who thinks in "how much do I have left"
  I want one switch that flips every budget percentage to remaining
  So that ctx, 5h and 7d all count down consistently

  # PRDv2 §3. New TOP-LEVEL key `percentage`: "consumed" (default) | "remaining".
  # The flip is display-only: 100 − used_percentage. It applies to the consumed-budget
  # / occupancy segments only — ctx, 5h, 7d. By decision (2026-05-27 session) cache%
  # is EXEMPT: it is a last-turn hit-rate quality ratio, not a consumed budget — like
  # idle (a duration), it never flips. Thresholds (amber/red, and the ctx zones) are
  # ALWAYS expressed in consumed terms internally: the color behavior is identical in
  # both modes; only the shown number changes. Token magnitudes are absolute and never
  # flip. Global per-key fallback (S2): a bad value falls back to "consumed".

  Scenario: Consumed is the default when the key is absent
    Given default config
    And stdin with used_percentage 19 for ctx and 67 for the 5h window
    When cc-cream runs
    Then the context segment reads "ctx:19%"
    And the 5h segment percentage reads "67%"

  Scenario: Remaining flips the context percentage
    Given config { "percentage": "remaining" }
    And stdin with used_percentage 19 and an input-token total of 38000
    When cc-cream runs
    Then the context segment reads "ctx:81% (38k)"

  Scenario: Remaining flips both rate-limit windows; countdown and magnitude unchanged
    Given config { "percentage": "remaining" }
    And the Pacific time is Monday 12:00
    And stdin five_hour with used_percentage 67 resetting in 43m
    And seven_day with used_percentage 41 resetting in 4 days
    When cc-cream runs
    Then row 2 reads "5h:33%·↺43m  7d:59%·↺4d"

  Scenario: The token magnitude is absolute and does not flip
    Given config { "percentage": "remaining" }
    And stdin with used_percentage 19 and an input-token total of 38000
    When cc-cream runs
    Then the magnitude reads "(38k)"

  Scenario: cache% is exempt and never flips
    Given config { "percentage": "remaining" }
    And stdin with a last-turn cache hit rate of 95%
    When cc-cream runs
    Then the cache segment reads "cache:95%"

  Scenario: idle is exempt — a duration, not a percentage
    Given config { "percentage": "remaining" }
    And stdin with an idle duration of 00:12
    When cc-cream runs
    Then the idle segment reads "idle:00:12"

  Scenario: Thresholds stay consumed-basis — color from consumed, number from remaining
    Given config { "percentage": "remaining", "segments": { "5h": { "red": 90 } } }
    And stdin five_hour with used_percentage 90 resetting in 43m
    When cc-cream runs
    Then the 5h segment percentage reads "10%"
    And the 5h segment is colored red

  Scenario: ctx color still tracks consumed under remaining mode
    Given config { "percentage": "remaining" }
    And stdin with used_percentage 80 and an input-token total of 160000
    When cc-cream runs
    Then the context segment reads "ctx:20% (160k)"
    And the context segment is colored red

  Scenario: Remaining flips the displayed figure under the ceiling basis too
    # S3/nebcamec: ceiling basis shows ceiling-consumed % (120k of 200k = 60%).
    # remaining flips that displayed figure: 100 − 60 = 40. Color still from consumed 60%.
    Given config { "percentage": "remaining", "segments": { "ctx": { "basis": "ceiling", "ceiling": 200000 } } }
    And stdin with used_percentage 12 and an input-token total of 120000
    When cc-cream runs
    Then the context segment reads "ctx:40% (120k)"
    And the context segment is colored red

  Scenario Outline: A bad percentage value falls back to consumed
    Given config { "percentage": "<bad>" }
    And stdin with used_percentage 19
    When cc-cream runs
    Then the context segment reads "ctx:19%"

    Examples:
      | bad     |
      | bogus   |
      | 42      |
