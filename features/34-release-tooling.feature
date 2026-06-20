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

  Scenario: nextVersion rejects an unrecognized bump keyword
    Given the current package version is "0.2.0"
    When I compute the next version for "huge" expecting it to fail
    Then it reports the bump keyword is unknown

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

  Scenario: setJsonVersion changes only the version value, preserving formatting
    Given a plugin manifest:
      """
      {
        "name": "cc-cream",
        "version": "0.2.0",
        "keywords": ["a", "b", "c"]
      }
      """
    When I set the manifest version to "0.3.0"
    Then the manifest version is "0.3.0"
    And the one-line keywords array is left untouched

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

  # The git/commit/tag orchestration, driven end-to-end against a throwaway
  # sandbox git repo. No real remote or `gh` is involved: the dry-run path runs
  # real git locally; the publish path swaps in a recording runner that captures
  # the would-be commands instead of executing them.

  Scenario: a dry run bumps all three version locations in lockstep and tags locally
    Given a sandbox release repo at version "0.2.0"
    When I run the release "patch --skip-tests" in the sandbox
    Then the release exits 0
    And the sandbox package.json version is "0.2.1"
    And the sandbox plugin manifest version is "0.2.1"
    And the sandbox CHANGELOG's first version heading is "0.2.1"
    And the sandbox HEAD commit subject is "Release v0.2.1"
    And the sandbox has an annotated tag "v0.2.1"

  Scenario: the publish path runs the test gate, commits, tags, pushes, and cuts a release
    Given a sandbox release repo at version "0.2.0"
    When I run the release "patch --publish" in the sandbox recording commands
    Then the release exits 0
    And the recorded commands include "pnpm test"
    And the recorded commands include "git add package.json plugin/.claude-plugin/plugin.json CHANGELOG.md"
    And the recorded commands include "git commit -m Release v0.2.1"
    And the recorded commands include "git tag -a v0.2.1 -m Release v0.2.1"
    And the recorded commands include "git push --follow-tags"
    And the recorded commands include "gh release create v0.2.1 --generate-notes"
    And the release output mentions "Released v0.2.1"

  Scenario: it refuses to release from a branch other than main
    Given a sandbox release repo at version "0.2.0"
    And the sandbox repo is checked out on "feature/wip"
    When I run the release "patch --skip-tests" in the sandbox
    Then the release exits 1
    And the release error mentions "not on main"
    And the sandbox package.json version is "0.2.0"

  Scenario: it refuses to release with uncommitted tracked changes
    Given a sandbox release repo at version "0.2.0"
    And the sandbox repo has an uncommitted tracked change
    When I run the release "patch --skip-tests" in the sandbox
    Then the release exits 1
    And the release error mentions "uncommitted changes"
    And the sandbox package.json version is "0.2.0"

  Scenario: it prints usage when no bump is given
    Given a sandbox release repo at version "0.2.0"
    When I run the release "--skip-tests" in the sandbox
    Then the release exits 1
    And the release error mentions "Usage"
