Feature: Plugin manifest and marketplace metadata (CREAM-qjhgdpnk)
  As a Claude Code user browsing the community catalog
  I want cc-cream to ship valid plugin and marketplace manifests
  So that I can discover and install it with /plugin install cc-cream

  # Split layout (CREAM plugin-cache-bloat fix): marketplace.json stays at the
  # repo-root .claude-plugin/ so the marketplace is discoverable, while the
  # plugin itself lives in a plugin/ subdirectory (marketplace source "./plugin")
  # whose own plugin/.claude-plugin/plugin.json + commands/ + hooks/ + src/ are
  # the only files copied into the plugin cache. Keeping package.json OUT of that
  # subtree stops Claude Code's installer from running `npm install` (which pulled
  # ~114 MB of devDependencies into the cache). Command files live in the plugin's
  # top-level commands/ directory and are auto-discovered — the plugin.json does
  # NOT declare a "commands" key. The install-time schema rejects a commands array
  # of file paths ("commands: Invalid input") even though "claude plugin validate"
  # accepts it; omitting the key + a top-level commands/ matches the official
  # ralph-loop layout. Name is the catalog-enforced lowercase kebab; the C.R.E.A.M.
  # backronym lives in the description, not the name. author and owner share one
  # identity: Bart Turczynski / support@spoonkeyworks.com.

  Scenario: The plugin manifest lives at the required path with required fields
    Then plugin/.claude-plugin/plugin.json exists and is valid JSON
    And it sets name to "cc-cream"
    And it sets displayName to "cc-cream"
    And it declares version, homepage, repository, and license MIT
    And it declares a non-empty keywords array
    And it sets author to "Bart Turczynski" with email "support@spoonkeyworks.com"
    And it does not declare a commands key so commands auto-discover from the top-level commands directory

  Scenario: The description carries the brand hook
    Then plugin.json description references "Claude Code Cache Rules Everything Around Me"

  Scenario: The manifests live in their split locations
    Then .claude-plugin contains exactly marketplace.json
    And plugin/.claude-plugin contains exactly plugin.json
    And the command files live in a top-level commands directory

  Scenario: The marketplace manifest lists cc-cream as a self-hosted entry
    Then .claude-plugin/marketplace.json exists and is valid JSON
    And the marketplace manifest has top-level name "bart-turczynski"
    And the marketplace manifest has a non-empty top-level description
    And it declares an owner with name "Bart Turczynski" and email "support@spoonkeyworks.com"
    And it lists a single plugin "cc-cream" with source "./plugin"
    And the plugin entry sets category "monitoring"
    And the plugin entry has a non-empty description
    And the plugin entry has homepage "https://github.com/bart-turczynski/cc-cream"

  Scenario: The name avoids reserved catalog prefixes
    Then the plugin name does not start with "claude-" or "anthropic-"
    And the plugin name is lowercase kebab-case
