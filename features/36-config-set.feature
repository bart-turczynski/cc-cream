Feature: Config field setter — --set key=value flag
  As a cc-cream user
  I want to set specific config values from the command line
  So that I can tune thresholds, ceiling, and percentage direction without hand-editing JSON

  # Top-level keys: "percentage", "numbers", "ttl"
  # Per-segment keys use segment.field dot-paths: "ctx.ceiling", "5h.amber", etc.

  Scenario: Set percentage direction to remaining
    Given no configure config raw
    When a set is planned for percentage=remaining
    Then the configure result is changed
    And the resulting config has percentage = "remaining"

  Scenario: Set ctx ceiling for large-context models
    Given no configure config raw
    When a set is planned for ctx.ceiling=100000
    Then the configure result is changed
    And the resulting config has segments.ctx.ceiling = 100000

  Scenario: Set a color threshold on a segment
    Given no configure config raw
    When a set is planned for ctx.amber=20
    Then the configure result is changed
    And the resulting config has segments.ctx.amber = 20

  Scenario: Set multiple assignments in one call
    Given no configure config raw
    When a set is planned for ctx.amber=20,ctx.orange=35,ctx.red=45
    Then the configure result is changed
    And the resulting config has segments.ctx.amber = 20
    And the resulting config has segments.ctx.orange = 35
    And the resulting config has segments.ctx.red = 45

  Scenario: Set ctx basis to ceiling mode
    Given no configure config raw
    When a set is planned for ctx.basis=ceiling
    Then the configure result is changed
    And the resulting config has segments.ctx.basis = "ceiling"

  Scenario: Set numbers format to exact
    Given no configure config raw
    When a set is planned for numbers=exact
    Then the configure result is changed
    And the resulting config has numbers = "exact"

  Scenario: Idempotent — no write when value already matches
    Given configure config raw: {"percentage":"remaining"}
    When a set is planned for percentage=remaining
    Then the configure result is not changed

  Scenario: Existing config keys are preserved
    Given configure config raw: {"numbers":"exact","segments":{"5h":{"on":false}}}
    When a set is planned for ctx.ceiling=150000
    Then the configure result is changed
    And the resulting config has numbers = "exact"
    And the resulting config has segments.5h.on = false
    And the resulting config has segments.ctx.ceiling = 150000

  Scenario: Existing per-segment fields are preserved when setting a different field
    Given configure config raw: {"segments":{"ctx":{"amber":25}}}
    When a set is planned for ctx.ceiling=100000
    Then the configure result is changed
    And the resulting config has segments.ctx.amber = 25
    And the resulting config has segments.ctx.ceiling = 100000

  Scenario: Unknown top-level key is rejected
    Given no configure config raw
    When a set is planned for colour=blue
    Then the configure result is not changed
    And the configure result has a problem mentioning "colour"

  Scenario: Unknown segment is rejected
    Given no configure config raw
    When a set is planned for gpu.amber=50
    Then the configure result is not changed
    And the configure result has a problem mentioning "gpu"

  Scenario: Unknown field on a known segment is rejected
    Given no configure config raw
    When a set is planned for ctx.ambre=25
    Then the configure result is not changed
    And the configure result has a problem mentioning "ambre"

  Scenario: Field not valid for that segment is rejected
    Given no configure config raw
    When a set is planned for model.ceiling=100000
    Then the configure result is not changed
    And the configure result has a problem mentioning "ceiling"

  Scenario: Out-of-domain value is rejected
    Given no configure config raw
    When a set is planned for percentage=diagonal
    Then the configure result is not changed
    And the configure result has a problem mentioning "percentage"

  Scenario: Missing equals sign is rejected
    Given no configure config raw
    When a set is planned for ctx.amber
    Then the configure result is not changed
    And the configure result has a problem mentioning "ctx.amber"

  Scenario: CLI writes the config file to disk and exits zero
    Given no cc-cream config file
    When the set CLI runs with args "--set percentage=remaining"
    Then it exits zero
    And the cc-cream config file has percentage = "remaining"

  Scenario: CLI accepts multiple --set flags
    Given no cc-cream config file
    When the set CLI runs with args "--set ctx.ceiling=100000 --set ctx.amber=20"
    Then it exits zero
    And the cc-cream config file has segments.ctx.ceiling = 100000
    And the cc-cream config file has segments.ctx.amber = 20

  Scenario: CLI exits non-zero on an unknown key
    Given no cc-cream config file
    When the set CLI runs with args "--set colour=blue"
    Then it exits non-zero
    And the configure CLI output mentions "colour"
