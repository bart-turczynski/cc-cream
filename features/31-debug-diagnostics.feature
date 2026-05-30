Feature: Opt-in debug diagnostics (CREAM-wsfhfgsx)
  As a user whose bar is unexpectedly empty or short
  I want an opt-in log explaining which segments were dropped and why
  So that "degrade, never crash" doesn't mean "fail with no explanation"

  # Claude Code silently discards statusLine stderr (surfaced only under
  # `claude --debug`, first invocation), so the channel is a LOG FILE, never
  # stdout — stdout is the bar and must stay token-free. CC_CREAM_DEBUG=1 turns it
  # on; CC_CREAM_DEBUG_LOG overrides the path. Off by default: no file, no cost.

  Scenario: Debug logging is off by default
    Given a session with only a model name
    When the engine runs
    Then no debug log file is written
    And the bar still renders to stdout

  Scenario: CC_CREAM_DEBUG records which on-by-default segments were dropped
    Given a session with only a model name
    And debug logging is enabled
    When the engine runs
    Then the debug log names "ctx" among the hidden segments
    And the debug log does not change what is printed to stdout
