Feature: Optional segments — effort and thinking
  As a power user
  I want effort and thinking indicators I can switch on
  So that I can watch settings that affect burn and cache

  # PRD §4.2. Off by default (on:false) because they can push Row 1 past 80 cols.
  # Null-checked: absent on models/CC versions that don't provide them (effort/thinking
  # additionally need CC 2.1.145), so they stay hidden even when enabled.

  Scenario: Off by default
    Given default config
    And stdin with effort.level "high" and thinking.enabled true
    When cc-cream runs
    Then neither the effort nor the thinking segment is rendered

  Scenario: Effort renders its level when enabled
    Given config { "segments": { "effort": { "on": true } } }
    And stdin with effort.level "high"
    When cc-cream runs
    Then the effort segment shows "high"

  Scenario: Thinking renders a boolean indicator when enabled
    Given config { "segments": { "thinking": { "on": true } } }
    And stdin with thinking.enabled true
    When cc-cream runs
    Then the thinking segment indicates thinking is on

  Scenario: Enabled but absent in stdin stays hidden (older CC or model without effort)
    Given config { "segments": { "effort": { "on": true } } }
    And stdin with no effort field
    When cc-cream runs
    Then the effort segment is not rendered
    And cc-cream exits 0
