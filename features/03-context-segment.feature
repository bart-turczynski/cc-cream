Feature: Context segment — occupancy percentage with magnitude and color zones
  As a Claude Code user
  I want ctx:NN% (mag) showing current-context occupancy
  So that I can tell when the window is filling toward model degradation

  # PRD §4.1, §4.4. Depends on S0: used_percentage is input-only, and the magnitude
  # uses the same input-only basis (the field S0 confirms) so percentage and
  # parenthetical agree. Default zones in raw used_percentage:
  #   <30 green · 30–40 amber · 40–50 orange · ≥50 red.
  # Threshold convention (§6): each color names the lower bound where it begins;
  # red is tested first, then orange, then amber.

  Scenario: Renders percentage and compact magnitude
    Given stdin with used_percentage 19 and an input-token total of 38000
    When cc-cream runs
    Then the context segment reads "ctx:19% [38k]"

  Scenario Outline: Default color zones
    Given stdin with used_percentage <pct>
    When cc-cream runs
    Then the context segment is colored <color>

    Examples:
      | pct | color  |
      | 10  | green  |
      | 29  | green  |
      | 30  | amber  |
      | 39  | amber  |
      | 40  | orange |
      | 49  | orange |
      | 50  | red    |
      | 80  | red    |

  Scenario: Thresholds are retunable via config
    Given config { "segments": { "ctx": { "amber": 50, "red": 75 } } }
    And stdin with used_percentage 60
    When cc-cream runs
    Then the context segment is colored amber

  Scenario: Exact numbers when configured
    Given config { "numbers": "exact" }
    And stdin with an input-token total of 38000
    When cc-cream runs
    Then the magnitude reads "[38000]" rather than "[38k]"

  Scenario: Hidden when the source field is absent
    Given stdin with no context_window
    When cc-cream runs
    Then the context segment is not rendered
    And cc-cream exits 0

  # nebcamec — configurable fullness reference. basis "window" (default) colors off
  # used_percentage of the real window; basis "ceiling" colors off total_input_tokens
  # / ceiling, so the warning fires at the same absolute size on any window (default
  # ceiling 200000). Shown % tracks the basis by default (number and color agree);
  # display "window" pins it to CC's window figure even under the ceiling basis.

  Scenario: Ceiling basis colors on absolute tokens, not window percentage
    # 120k tokens is only 12% of a 1M window (green under "window") but 60% of the
    # 200k ceiling — the early-warning the issue exists to restore.
    Given config { "segments": { "ctx": { "basis": "ceiling" } } }
    And stdin with used_percentage 12 and an input-token total of 120000
    When cc-cream runs
    Then the context segment reads "ctx:60% [120k]"
    And the context segment is colored red

  Scenario: Window basis is the default and ignores the ceiling (no regression)
    Given config { "segments": { "ctx": { "basis": "window" } } }
    And stdin with used_percentage 12 and an input-token total of 120000
    When cc-cream runs
    Then the context segment reads "ctx:12% [120k]"
    And the context segment is colored green

  Scenario Outline: Ceiling thresholds are percent of the ceiling
    Given config { "segments": { "ctx": { "basis": "ceiling", "ceiling": 200000 } } }
    And stdin with used_percentage 5 and an input-token total of <tokens>
    When cc-cream runs
    Then the context segment is colored <color>

    Examples:
      | tokens | color  |
      | 50000  | green  |
      | 70000  | amber  |
      | 90000  | orange |
      | 110000 | red    |

  Scenario: display "window" shows CC's window percentage but colors by the ceiling
    Given config { "segments": { "ctx": { "basis": "ceiling", "display": "window" } } }
    And stdin with used_percentage 12 and an input-token total of 120000
    When cc-cream runs
    Then the context segment reads "ctx:12% [120k]"
    And the context segment is colored red

  Scenario: Ceiling basis degrades to the window when the magnitude is absent
    Given config { "segments": { "ctx": { "basis": "ceiling" } } }
    And stdin with used_percentage 12
    When cc-cream runs
    Then the context segment reads "ctx:12%"
    And the context segment is colored green
