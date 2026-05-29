Feature: Plugin manifest and marketplace metadata (CREAM-qjhgdpnk)
  As a Claude Code user browsing the community catalog
  I want cc-cream to ship valid plugin and marketplace manifests
  So that I can discover and install it with /plugin install cc-cream

  # docs/RELEASE_PLAN.md Phase 1.2/1.3. Single-repo layout: both plugin.json and
  # marketplace.json live inside .claude-plugin/ and are the only two files there;
  # the plugin entry uses source "./". Name is the catalog-enforced lowercase
  # kebab; the C.R.E.A.M. backronym lives in the description, not the name.
  # author and owner share one identity: Bart Turczynski / support@spoonkeyworks.com.

  Scenario: The plugin manifest lives at the required path with required fields
    Then .claude-plugin/plugin.json exists and is valid JSON
    And it sets name to "cc-cream"
    And it sets displayName to "cc-cream"
    And it declares version, homepage, repository, and license MIT
    And it declares a non-empty keywords array
    And it sets author to "Bart Turczynski" with email "support@spoonkeyworks.com"
    And it registers the setup command at "../commands/setup.md"

  Scenario: The description carries the brand hook
    Then plugin.json description references "Claude Code Cache Rules Everything Around Me"

  Scenario: Both manifests are the only files inside .claude-plugin
    Then .claude-plugin contains exactly plugin.json and marketplace.json
    And no commands, agents, hooks, or source modules live inside .claude-plugin

  Scenario: The marketplace manifest lists cc-cream as a self-hosted entry
    Then .claude-plugin/marketplace.json exists and is valid JSON
    And the marketplace manifest has top-level name "cc-cream"
    And the marketplace manifest has a non-empty top-level description
    And it declares an owner with name "Bart Turczynski" and email "support@spoonkeyworks.com"
    And it lists a single plugin "cc-cream" with source "./"
    And the plugin entry sets category "monitoring"
    And the plugin entry has a non-empty description
    And the plugin entry has homepage "https://github.com/bart-turczynski/cc-cream"

  Scenario: The name avoids reserved catalog prefixes
    Then the plugin name does not start with "claude-" or "anthropic-"
    And the plugin name is lowercase kebab-case
