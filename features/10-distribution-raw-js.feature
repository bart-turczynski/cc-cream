Feature: Distribution as a raw .js file on GitHub
  As a prospective user
  I want to install cc-cream from a single .js file on GitHub
  So that I can adopt it with minimal friction and no package manager

  # PRD §7, §14.1. v1 ships ONE channel: raw .js on GitHub. The npm bin and the
  # marketplace plugin wrapper are deferred to v2 (§14.1). The engine stays a
  # single file using only Node built-ins, so the deferred channels are cheap later.

  Scenario: The engine is a single self-contained .js file
    Then the published artifact is one .js file using only Node built-ins
    And it declares no runtime dependencies

  Scenario: The README documents the raw-.js install path
    Then the README explains downloading the .js and running the consent installer
    And it states the minimum Claude Code version of 2.1.132

  Scenario: Running the file against stdin produces the bar within the event-path budget
    Given the downloaded cc-cream.js
    When Claude Code pipes it a session JSON on stdin
    Then it prints the formatted bar to stdout
    And it finishes well inside the ~300ms post-message event path (PRD §8)
