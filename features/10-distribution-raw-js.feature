Feature: Distribution as raw JavaScript on GitHub
  As a prospective user
  I want to install cc-cream from JavaScript files on GitHub
  So that I can adopt it with minimal friction and no package manager

  # PRD §7, §14.1. Raw JavaScript on GitHub is the original v1 install channel.
  # npm bin packaging ships in v3 (CREAM-cvmhzchg); see
  # features/18-distribution-npm.feature. Runtime code may use local modules but
  # must not require external runtime dependencies.

  Scenario: The runtime has no external dependencies
    Then the published runtime uses only Node built-ins and local modules
    And it declares no runtime dependencies

  Scenario: The README documents the raw JavaScript install path
    Then the README explains downloading the .js and running the consent installer
    And it states the minimum Claude Code version of 2.1.132

  Scenario: Running the file against stdin produces the bar within the event-path budget
    Given the downloaded cc-cream.js
    When Claude Code pipes it a session JSON on stdin
    Then it prints the formatted bar to stdout
    And it finishes well inside the ~300ms post-message event path (PRD §8)
