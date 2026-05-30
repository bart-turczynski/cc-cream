Feature: Release tooling keeps every version location in lockstep (CREAM-rkxwseym)
  As the maintainer
  I want one command to cut a release without hand-syncing versions
  So that the CHANGELOG, package.json, package-lock.json, and plugin.json never drift

  # scripts/release.mjs. The pure helpers — nextVersion() and rollChangelog() — are
  # exercised here; the git/commit/tag side of the script is the release runbook
  # (features/25, @manual). rollChangelog promotes the [Unreleased] section to a
  # dated version section and leaves a fresh empty [Unreleased] on top, so the
  # version-match gate keeps passing across the bump.

  Scenario Outline: nextVersion bumps semver from the current version
    Given the current package version is "0.2.0"
    When I compute the next version for "<bump>"
    Then the next version is "<result>"

    Examples:
      | bump  | result |
      | patch | 0.2.1  |
      | minor | 0.3.0  |
      | major | 1.0.0  |
      | 4.5.6 | 4.5.6  |

  Scenario: rollChangelog promotes Unreleased to a dated version and reopens Unreleased
    Given a CHANGELOG with entries under Unreleased:
      """
      # Changelog

      ## [Unreleased]

      ### Fixed
      - A real fix.

      ## [0.2.0] — 2026-05-30

      ### Added
      - Older stuff.
      """
    When I roll the CHANGELOG to "0.3.0" dated "2026-06-01"
    Then the rolled CHANGELOG's first version heading is "0.3.0" dated "2026-06-01"
    And the rolled CHANGELOG keeps an empty Unreleased section on top
    And the entry "A real fix." now sits under the 0.3.0 heading

  Scenario: rollChangelog refuses to release an empty Unreleased section
    Given a CHANGELOG with an empty Unreleased section:
      """
      # Changelog

      ## [Unreleased]

      ## [0.2.0] — 2026-05-30

      ### Added
      - Older stuff.
      """
    When I roll the CHANGELOG expecting it to fail
    Then it reports there is nothing to release
