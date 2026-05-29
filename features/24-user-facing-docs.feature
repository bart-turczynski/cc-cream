Feature: User-facing documentation and trust disclosure (CREAM-wgmhqfls)
  As a prospective user evaluating cc-cream
  I want a clear README and honest data disclosure
  So that I can install it via my preferred channel and trust what it does

  # docs/RELEASE_PLAN.md Phase 4. The README is rewritten for end users (the
  # current one is contributor-facing). The no-network / no-telemetry / zero-deps
  # / zero-tokens posture is a positioning pillar and the catalog's data
  # disclosure, so it must be stated prominently and be literally true.

  Scenario: The README documents all three v1 install paths
    Then the README documents installing from the community catalog or self-hosted marketplace
    And it documents installing via npm or npx
    And it documents the manual GitHub clone path

  Scenario: The README states the trust and version requirements
    Then the README states the minimum Claude Code version of 2.1.132
    And it notes effort and thinking segments require 2.1.145

  Scenario: The README discloses the data posture prominently
    Then the README states that cc-cream makes no network calls
    And it states that it collects no telemetry
    And it states that it has no runtime dependencies and costs zero tokens

  Scenario: The README shows what the bar looks like and how to configure it
    Then the README includes a visual of the rendered status bar
    And it documents the ~/.claude/cc-cream.json configuration and the segment catalog

  Scenario: Trust signal files are present
    Then a SECURITY.md describes the threat model and the no-network posture
    And a CONTRIBUTING.md states the best-effort maintenance posture

  Scenario: The macOS and Linux scope is stated honestly
    Then the README states that v1 supports macOS and Linux
    And it notes Windows support is a planned fast-follow
