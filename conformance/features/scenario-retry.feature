Feature: Scenario retry and quarantine

  @retry:2
  Scenario: retried until it passes
    Given a step that passes on scenario attempt 2

  @retry:1
  Scenario: retries exhausted
    Given a step that passes on scenario attempt 5

  @quarantine
  Scenario: quarantined failure
    Given a failing step
