Feature: Plugin manifest and marketplace metadata (CREAM-qjhgdpnk)
  As a Claude Code user browsing the community catalog
  I want cc-cream to ship valid plugin and marketplace manifests
  So that I can discover and install it with /plugin install cc-cream

  # Plugin payload lives in plugin/ subdirectory; plugin/.claude-plugin/plugin.json
  # is the only manifest in this repo. The self-hosted marketplace has moved to the
  # lean catalogue repo bart-turczynski/claude-plugins (install:
  # /plugin marketplace add bart-turczynski/claude-plugins). Keeping package.json
  # OUT of plugin/ stops Claude Code's installer from running `npm install` (which
  # pulled ~114 MB of devDependencies into the cache). Command files live in
  # plugin/commands/ and are auto-discovered — plugin.json does NOT declare a
  # "commands" key (install-time schema rejects an array of file paths; omitting
  # the key + a top-level commands/ matches the official ralph-loop layout). Name
  # is the catalog-enforced lowercase kebab; the C.R.E.A.M. backronym lives in
  # the description, not the name. author identity: Bart Turczynski /
  # support@spoonkeyworks.com.

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

  Scenario: The manifests live in their correct locations
    Then plugin/.claude-plugin contains exactly plugin.json
    And the command files live in a top-level commands directory

  Scenario: The name avoids reserved catalog prefixes
    Then the plugin name does not start with "claude-" or "anthropic-"
    And the plugin name is lowercase kebab-case
