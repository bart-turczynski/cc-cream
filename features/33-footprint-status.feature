Feature: Footprint status report (CREAM-zgdcbmfj)
  As a user unsure whether cc-cream fully went away
  I want one read-only command that lists cc-cream's entire on-disk footprint
  So that I can confirm a clean slate or see exactly what's left to remove

  # cc-cream-setup --status. Read-only. No Claude Code host removal path drops our
  # statusLine or GCs the version cache, so users otherwise can't tell whether
  # cc-cream fully went away. The report covers the statusLine wiring, plugin cache
  # versions, marketplace clone + registration, the auto-wire marker, session
  # state, config, and the manual runtime copy.

  Scenario: A clean config dir reports a clean slate
    When cc-cream-setup --status runs
    Then the status report exits zero
    And the report says it is a clean slate

  Scenario: A full footprint is enumerated component by component
    Given a full cc-cream footprint on disk
    When cc-cream-setup --status runs
    Then the status report exits zero
    And the report lists the statusLine wiring as cc-cream's
    And the report lists the plugin cache versions
    And the report lists the session state, config, and manual runtime copy
    And the report does not say it is a clean slate

  # CREAM-axtbxevj: every host-side path carries a `<marketplace>` segment the
  # host owns, and ours was renamed (cc-cream -> bart-turczynski). A report that
  # spells the old name out reports "none" for a cache, clone, registration and
  # marker that are all present — the exact opposite of what this command is for.
  # The fixture stages a marketplace that is not the plugin name, so only a
  # derived path can find any of it.
  Scenario: The footprint is found under a renamed marketplace
    Given a full cc-cream footprint on disk
    When cc-cream-setup --status runs
    Then the status report exits zero
    And the report locates the cache, clone, registration and marker under the real marketplace
    And the removal instructions name the real marketplace

  Scenario: A stale statusLine pinned to a missing entrypoint is flagged
    Given a cc-cream statusLine pinned to a missing entrypoint
    When cc-cream-setup --status runs
    Then the status report exits zero
    And the report flags the statusLine entrypoint as missing
