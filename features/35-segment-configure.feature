Feature: Segment visibility — --show / --hide config flags
  As a cc-cream user
  I want to toggle segments on or off from the command line
  So that I can tailor the status-line bar without hand-editing JSON

  # planConfigure is a pure function; most scenarios test the logic layer.
  # The final two scenarios exercise the CLI (spawnSync) to cover disk I/O.

  Scenario: Hide named segments writes on:false into the config
    Given no configure config raw
    When configure is planned to hide "5h,7d,peak"
    Then the configure result is changed
    And the resulting config has segments.5h.on = false
    And the resulting config has segments.7d.on = false
    And the resulting config has segments.peak.on = false

  Scenario: Show a previously hidden segment
    Given configure config raw: {"segments":{"5h":{"on":false}}}
    When configure is planned to show "5h"
    Then the configure result is changed
    And the resulting config has segments.5h.on = true

  Scenario: Show all resets hidden segments back to visible
    Given configure config raw: {"segments":{"5h":{"on":false},"7d":{"on":false}}}
    When configure is planned to show "all"
    Then the configure result is changed
    And the resulting config has segments.5h.on = true
    And the resulting config has segments.7d.on = true

  Scenario: Hide all segments
    Given no configure config raw
    When configure is planned to hide "all"
    Then the configure result is changed
    And the resulting config has segments.ctx.on = false
    And the resulting config has segments.model.on = false

  Scenario: --hide takes precedence over --show for the same segment
    Given no configure config raw
    When configure is planned with show "all" and hide "5h,7d"
    Then the configure result is changed
    And the resulting config has segments.5h.on = false
    And the resulting config has segments.7d.on = false

  Scenario: Unknown segment name is rejected with a problem
    Given no configure config raw
    When configure is planned to hide "ghost"
    Then the configure result is not changed
    And the configure result has a problem mentioning "ghost"

  Scenario: Multiple unknown segment names are all reported
    Given no configure config raw
    When configure is planned to hide "ghost,phantom"
    Then the configure result has a problem mentioning "ghost"
    And the configure result has a problem mentioning "phantom"

  Scenario: Idempotent — no write when on:false is already set
    Given configure config raw: {"segments":{"5h":{"on":false}}}
    When configure is planned to hide "5h"
    Then the configure result is not changed

  Scenario: Idempotent — no write when segment is already visible by default
    Given no configure config raw
    When configure is planned to show "ctx"
    Then the configure result is not changed

  Scenario: Existing top-level config keys are preserved
    Given configure config raw: {"numbers":"exact","segments":{"ctx":{"amber":25}}}
    When configure is planned to hide "5h"
    Then the configure result is changed
    And the resulting config has numbers = "exact"
    And the resulting config has segments.ctx.amber = 25

  Scenario: Existing per-segment fields besides on are preserved
    Given configure config raw: {"segments":{"ctx":{"amber":25,"on":true}}}
    When configure is planned to hide "ctx"
    Then the configure result is changed
    And the resulting config has segments.ctx.amber = 25
    And the resulting config has segments.ctx.on = false

  Scenario: CLI writes the config file to disk and exits zero
    Given no cc-cream config file
    When the configure CLI runs with args "--hide 5h,7d"
    Then it exits zero
    And the cc-cream config file has segments.5h.on = false
    And the cc-cream config file has segments.7d.on = false

  Scenario: CLI exits non-zero and prints the unknown segment on a bad name
    Given no cc-cream config file
    When the configure CLI runs with args "--hide ghost"
    Then it exits non-zero
    And the configure CLI output mentions "ghost"
