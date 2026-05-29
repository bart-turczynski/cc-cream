Feature: Security hardening
  cc-cream reads untrusted stdin and rewrites the user's settings file. Text
  segments must never carry terminal escape sequences to the TTY, settings/state
  writes must be atomic, a crafted session_id must not corrupt the session map,
  and the map must not grow without bound.

  # --- Terminal escape-sequence injection (stdin echoed verbatim to the TTY) ---

  Scenario: Escape sequences in model display_name are stripped from the bar
    Given stdin whose model display_name carries terminal escape sequences
    When cc-cream runs
    Then the output contains no terminal control characters
    And the output still shows the printable part of the name

  Scenario: Escape sequences in session_name are stripped from the bar
    Given stdin whose session_name carries terminal escape sequences, with the segment enabled
    When cc-cream runs
    Then the output contains no terminal control characters

  # --- Atomic settings/state writes (no truncation, no temp residue) ---

  Scenario: An atomic write leaves the target intact and no temp file behind
    When I atomically write "hello world" to a file in the sandbox
    Then the file contains exactly "hello world"
    And no temporary write-file remains in the directory

  # --- A crafted session_id used as an object key cannot pollute the map ---

  Scenario: A "__proto__" session_id neither crashes nor records state
    Given a session_id of "__proto__"
    And stdin with total_cost_usd 1.50
    When cc-cream runs
    Then the output is not empty
    And no session entry is recorded for "__proto__"

  # --- Unbounded session growth is capped ---

  Scenario: The session map is capped, evicting the oldest sessions
    Given a session state holding 60 sessions
    When a new session is patched in
    Then the session map keeps at most 50 sessions
    And it keeps the newest prior session and drops the oldest
