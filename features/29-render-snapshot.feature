Feature: Golden render snapshot (CREAM-twlrcxdk)
  As a maintainer refactoring the render path
  I want one deterministic full-bar snapshot
  So that holistic row assembly is locked before the pure-render refactor

  # A characterization test: it pins every time-dependent input (fixed clock,
  # in-sandbox transcript at age 0, sub-day rate-limit resets) so the whole
  # three-row bar is reproducible on any machine. The pure-render refactor
  # (v4-S4) must leave this output byte-for-byte unchanged.

  Scenario: A representative subscriber session renders a stable three-row bar
    Given a fully-specified subscriber session at a fixed time
    When the engine runs
    Then the rendered bar exactly matches the golden snapshot:
      """
      ctx:15% [31k] | cache:38% | ttl:01:00 | ~$0.10
      5h:22% ↺ 1h30m | 7d:36% ↺ 3h20m
      Sonnet 4.6
      """
