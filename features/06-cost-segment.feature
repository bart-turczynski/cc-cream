Feature: Cost segment — notional session cost
  As a Claude Code user
  I want ~$X.XX from cost.total_cost_usd
  So that I see directional API-equivalent value (subscribers) or near-actual spend (API users)

  # PRD §2, §4.1, §12. The tilde marks it an estimate. The figure includes
  # subagent spend (verified live, §12). Auto-hidden when zero or absent.

  Scenario: Renders with the tilde estimate marker
    Given stdin with total_cost_usd 4.50
    When cc-cream runs
    Then the cost segment reads "~$4.50"
    And the cost segment has no color

  Scenario: Auto-hidden when cost is zero (brand-new session before its first API turn)
    Given stdin with total_cost_usd 0
    When cc-cream runs
    Then the cost segment is not rendered

  Scenario: Auto-hidden when the cost field is absent
    Given stdin with no cost field
    When cc-cream runs
    Then the cost segment is not rendered
