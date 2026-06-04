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
    Then the pretest flow invokes a "validate" script running "claude plugin validate plugin"

  Scenario: The gate skips gracefully when the claude CLI is unavailable
    Given the "claude" CLI is not installed
    When the validate script runs
    Then it exits zero with a skip notice and does not block the build

  # @needs-cli: this scenario shells out to a live `claude` to prove the gate
  # actually blocks a bad manifest. CI runners lack the CLI, so it is excluded
  # from the default (publish-gating) profile and run via `npm run test:cli`.
  @needs-cli
  Scenario: A manifest error fails the everyday gate
    Given a plugin.json with an invalid field type
    And the "claude" CLI is installed
    When the validate script runs
    Then it exits non-zero so the gate blocks the change

  # @manual: the --strict pass is a pre-submission readiness check that needs the
  # claude CLI; CI runners don't have it, so this would go pending (and fail
  # cucumber's strict mode / prepublishOnly). Run it via `npm run test:manual`.
  @manual
  Scenario: The pre-submission pass demands a fully clean strict report
    Given the plugin and marketplace manifests
    When "claude plugin validate . --strict" runs before submission
    Then it reports no errors and no warnings

  # CREAM-xzhidmjt. prepublishOnly runs `npm test` at publish time. The class of
  # bug: any scenario that shells out to a host CLI absent on CI runners can break
  # `npm publish`, and only at release time. The durable guard is a CI workflow
  # that runs the exact publish gate on a clean runner (no claude CLI) on every
  # PR, so the failure surfaces in review instead of at publish. CLI-shelling
  # scenarios are tagged @needs-cli and excluded from the default profile, so the
  # publish gate is CI-safe by construction.
  Scenario: The publish gate is verified on a CI runner without the claude CLI
    Then a CI workflow runs "npm test" on pull requests
    And the default cucumber profile excludes both @manual and @needs-cli
    And prepublishOnly runs the default profile, never @needs-cli scenarios
