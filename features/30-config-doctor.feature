Feature: Config doctor (CREAM-kkjlhexy)
  As a user editing ~/.claude/cc-cream.json by hand
  I want a command that flags keys cc-cream will ignore
  So that a typo isn't a silent no-op

  # The renderer is intentionally forgiving — an unknown or out-of-domain field
  # falls back to its default with no feedback. `cc-cream-setup --check-config`
  # surfaces those, using the same schema table that drives normalization. It
  # exits non-zero when there's something to fix, zero when the config is clean
  # (or absent/empty — defaults apply, nothing to check).

  Scenario: A clean config reports no problems
    Given a cc-cream config file:
      """
      { "numbers": "exact", "segments": { "ctx": { "amber": 25, "on": false } } }
      """
    When the config doctor runs
    Then the config doctor reports no problems and exits zero

  Scenario: An unknown top-level key is reported
    Given a cc-cream config file:
      """
      { "colour": "blue" }
      """
    When the config doctor runs
    Then the config doctor reports a problem mentioning "colour" and exits non-zero

  Scenario: An unknown segment field is reported
    Given a cc-cream config file:
      """
      { "segments": { "ctx": { "ambre": 25 } } }
      """
    When the config doctor runs
    Then the config doctor reports a problem mentioning "ambre" and exits non-zero

  Scenario: An unknown segment is reported
    Given a cc-cream config file:
      """
      { "segments": { "gpu": { "on": true } } }
      """
    When the config doctor runs
    Then the config doctor reports a problem mentioning "gpu" and exits non-zero

  Scenario: An out-of-domain value is reported
    Given a cc-cream config file:
      """
      { "segments": { "ctx": { "row": 9 } } }
      """
    When the config doctor runs
    Then the config doctor reports a problem mentioning "row" and exits non-zero

  Scenario: A missing config is fine
    Given no cc-cream config file
    When the config doctor runs
    Then the config doctor reports no problems and exits zero
