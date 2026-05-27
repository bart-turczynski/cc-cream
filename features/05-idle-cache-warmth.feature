Feature: Idle / cache-warmth segment with inferred TTL
  As a Claude Code user
  I want idle:hh:mm since last activity, colored against the cache TTL
  So that I get an early warning before the cache goes cold

  # PRD §4.1, §4.5, §8, §9. idle = now − mtime(transcript_path). Count-up hh:mm, no
  # seconds (refresh is 60s). Bands are percent of the RESOLVED TTL:
  # <50% green · 50–80% amber · ≥80% red, staying red past expiry.

  Scenario: Zero while actively working reads as a warm-cache health light
    Given the transcript was just appended, so its mtime is now
    When cc-cream runs
    Then the idle segment reads "idle:00:00" and is green

  Scenario: Zero-padded hh:mm formatting
    Given the transcript mtime was 52 minutes ago
    When cc-cream runs
    Then the idle segment reads "idle:00:52"

  Scenario Outline: Color bands against a 60-minute subscriber TTL
    Given a resolved TTL of 60 minutes
    And the transcript mtime was <mins> minutes ago
    When cc-cream runs
    Then the idle segment is colored <color>

    Examples:
      | mins | color |
      | 5    | green |
      | 30   | amber |
      | 48   | red   |
      | 75   | red   |

  Scenario Outline: TTL inference resolution order
    Given environment <env> and rate_limits <rate_limits>
    When cc-cream resolves the TTL
    Then the resolved TTL is <ttl> minutes

    Examples:
      | env                      | rate_limits        | ttl |
      | FORCE_PROMPT_CACHING_5M  | present, under cap | 5   |
      | none                     | present, under cap | 60  |
      | none                     | present, over cap  | 5   |
      | ENABLE_PROMPT_CACHING_1H | absent (API user)  | 60  |
      | none                     | absent (API user)  | 5   |

  Scenario: "auto" is safer than a pin for an over-limit subscriber
    Given config { "ttl": "auto" }
    And rate_limits with a window at used_percentage 100
    When cc-cream resolves the TTL
    Then the resolved TTL drops to 5 minutes

  Scenario: Hidden, not idle:00:00, when transcript_path is absent or cannot be stat-ed
    Given stdin with no transcript_path
    When cc-cream runs
    Then the idle segment is not rendered
    And cc-cream exits 0
