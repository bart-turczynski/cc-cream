Feature: isOrphanedPluginRun — in-process unit tests (CREAM-uadphjbe)
  These scenarios call isOrphanedPluginRun() directly so that c8 can track
  the branches that the subprocess-spawning feature-32 scenarios cannot reach.

  Scenario: path not under the plugin cache is never an orphan
    When isOrphanedPluginRun is called with the engine's real path
    Then the orphan result is false

  Scenario: cache path with no registry file (ENOENT) counts as orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true

  Scenario: cache path with corrupt registry (non-ENOENT) is conservatively not orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry file is corrupt
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is false

  Scenario: cache path with registry listing only other plugins is orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry lists other plugins but not cc-cream
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true

  Scenario: cache path with registry listing cc-cream at a matching installPath is not orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry lists cc-cream
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is false

  Scenario: registry with plugins key set to null counts as orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry has a null plugins key
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true

  Scenario: registry with a non-array plugins entry is skipped and counts as orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry has a non-array plugins entry
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true

  Scenario: registry entry with a non-string installPath is not matched and counts as orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry has a non-string installPath entry
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true

  Scenario: registry entry with a non-existent installPath triggers realpathOr fallback and counts as orphaned
    Given the engine is installed in the plugin cache as version "0.2.0"
    And the host plugin registry has a non-existent installPath entry
    When isOrphanedPluginRun is called with the cached engine path
    Then the orphan result is true
