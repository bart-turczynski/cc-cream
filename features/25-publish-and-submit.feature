Feature: Publish and submit to the community catalog (CREAM-vtjzppjr)
  As the maintainer
  I want a repeatable publish-and-submit checklist
  So that cc-cream lands on every channel in the right order, ending at the catalog

  # docs/RELEASE_PLAN.md Phase 5. Priority order: GitHub (source of record) ->
  # npm -> self-hosted marketplace (free from the manifests) -> community catalog
  # submission (the goal). This is an operational checklist, not engine BDD: the
  # release GATES below are maintainer-controllable and verifiable at release time;
  # the POST-SUBMISSION section tracks outcomes owned by external actors (npm
  # indexing, Anthropic review) and must NEVER block CI.

  # --- Automated gates (verifiable in CI) ---

  Scenario: The release version matches the latest CHANGELOG entry
    Then package.json version matches the latest CHANGELOG entry

  # Nothing used to enforce this, so plugin.json was hand-synced every release and
  # could silently drift (CREAM-rkxwseym v5). `npm run release` keeps them in
  # lockstep; this gate makes drift a CI failure instead of a stale manifest.
  Scenario: The plugin manifest version matches package.json
    Then .claude-plugin/plugin.json version matches package.json

  Scenario: The self-hosted marketplace install path is documented
    Then the README documents adding the marketplace with "/plugin marketplace add bart-turczynski/cc-cream"
    And then installing with "/plugin install cc-cream"

  # --- Release gates (controllable at release time, not automatable in CI) ---

  @manual
  Scenario: The repository is publish-ready, tagged, and noted
    Then the GitHub repository is public
    And the release commit is tagged with the published version
    And the release has written release notes

  @manual
  Scenario: The npm package is published at the planned version
    When "npm publish" runs for cc-cream
    Then the npm registry accepts cc-cream at version 0.1.1

  @manual
  Scenario: The plugin is submitted to the community catalog
    When the repo is submitted at clau.de/plugin-directory-submission
    Then the submission form is accepted for review

  # --- Post-submission observations (external actors; tracked, never a CI gate) ---

  @manual
  Scenario: npm indexing makes npx resolution available
    Given cc-cream has been published to npm
    When npm registry indexing completes (typically minutes)
    Then "npx -y cc-cream@latest" resolves and runs the engine

  @manual
  Scenario: Anthropic review lands cc-cream in the catalog
    Given the submission was accepted for review
    When automated security scanning and human review complete (typically days)
    Then the catalog marketplace.json gains a cc-cream entry pinned to a commit SHA
