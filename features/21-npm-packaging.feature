Feature: npm packaging — license and lean published tarball (CREAM-oqhmzpgy)
  As a user who prefers npm
  I want cc-cream published as a clean, licensed npm package
  So that I can install it with npx or a global install and trust its provenance

  # docs/RELEASE_PLAN.md Phase 1.1/1.4. SCOPE: LICENSE + package.json publish
  # metadata only. The bin entry and shebang already ship
  # (features/18-distribution-npm.feature); the plugin.json / marketplace.json
  # manifests are deliberately a separate slice (features/20-*.feature). This
  # slice keeps the published tarball to runtime files only.

  Scenario: The repository carries an MIT license file
    Then a LICENSE file exists at the repo root
    And it is an MIT license
    And package.json license field is "MIT"

  Scenario: package.json declares publish metadata
    Then package.json declares a node engines constraint
    And it declares repository, bugs, and homepage URLs
    And it declares an author and keywords

  Scenario: The published tarball ships only runtime files
    Then package.json restricts published files to the runtime via a files allowlist
    And the allowlist includes src and LICENSE and README.md
    And the allowlist excludes features, fixtures, docs, and archive

  Scenario: The runtime still has no external dependencies
    Then the published runtime uses only Node built-ins and local modules
    And it declares no runtime dependencies
