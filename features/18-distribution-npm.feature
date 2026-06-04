Feature: Distribution as an npm package (CREAM-cvmhzchg)
  As a prospective user
  I want to install cc-cream via npm or npx
  So that I can adopt it without manually downloading files

  # npm bin packaging — the no-runtime-dependency constraint means this is
  # cheap to add: the engine just needs a shebang and a bin entry in package.json.
  # Consent installer (S9) already handles settings.json wiring.

  Scenario: package.json declares a bin entry pointing to the engine
    Then package.json has a bin entry for "cc-cream" pointing to the engine

  Scenario: The engine file starts with the node shebang for direct execution
    Then plugin/src/cc-cream.js starts with "#!/usr/bin/env node"
