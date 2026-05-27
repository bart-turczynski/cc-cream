Feature: Context segment — occupancy percentage with magnitude and color zones
  As a Claude Code user
  I want ctx:NN% (mag) showing current-context occupancy
  So that I can tell when the window is filling toward model degradation

  # PRD §4.1, §4.4. Depends on S0: used_percentage is input-only, and the magnitude
  # uses the same input-only basis (the field S0 confirms) so percentage and
  # parenthetical agree. Default zones in raw used_percentage: <25 green · 25–40 amber · ≥40 red.
  # Threshold convention (§6): each color names the lower bound where it begins; red is tested first.

  Scenario: Renders percentage and compact magnitude
    Given stdin with used_percentage 19 and an input-token total of 38000
    When cc-cream runs
    Then the context segment reads "ctx:19% (38k)"

  Scenario Outline: Default color zones
    Given stdin with used_percentage <pct>
    When cc-cream runs
    Then the context segment is colored <color>

    Examples:
      | pct | color |
      | 10  | green |
      | 24  | green |
      | 25  | amber |
      | 39  | amber |
      | 40  | red   |
      | 80  | red   |

  Scenario: Thresholds are retunable via config
    Given config { "segments": { "ctx": { "amber": 50, "red": 75 } } }
    And stdin with used_percentage 60
    When cc-cream runs
    Then the context segment is colored amber

  Scenario: Exact numbers when configured
    Given config { "numbers": "exact" }
    And stdin with an input-token total of 38000
    When cc-cream runs
    Then the magnitude reads "(38000)" rather than "(38k)"

  Scenario: Hidden when the source field is absent
    Given stdin with no context_window
    When cc-cream runs
    Then the context segment is not rendered
    And cc-cream exits 0
