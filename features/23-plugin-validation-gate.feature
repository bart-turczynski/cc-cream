Feature: Plugin validation gate (CREAM-ldigvksg)
  As a maintainer preparing a catalog submission
  I want plugin validation wired into the test flow
  So that manifest regressions are caught before publish or submission

  # docs/RELEASE_PLAN.md Phase 3.1. The everyday gate runs `claude plugin validate .`
  # (errors block) inside pretest, alongside lint + knip. It skips gracefully when
  # the `claude` CLI is absent so contributors without it are not blocked. The
  # stricter `--strict` (warnings-as-errors) run is reserved for the pre-submission
  # readiness pass, where a fully clean report is the goal — `--strict` can trip on
  # benign unrecognized-field warnings, so it is not the blocking everyday gate.

  Scenario: Validation runs in pretest as part of the everyday gate
    Then the pretest flow invokes a "validate" script running "claude plugin validate ."

  Scenario: The gate skips gracefully when the claude CLI is unavailable
    Given the "claude" CLI is not installed
    When the validate script runs
    Then it exits zero with a skip notice and does not block the build

  Scenario: A manifest error fails the everyday gate
    Given a plugin.json with an invalid field type
    And the "claude" CLI is installed
    When the validate script runs
    Then it exits non-zero so the gate blocks the change

  Scenario: The pre-submission pass demands a fully clean strict report
    Given the plugin and marketplace manifests
    When "claude plugin validate . --strict" runs before submission
    Then it reports no errors and no warnings
