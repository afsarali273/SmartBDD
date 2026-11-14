Feature: Resilience

  # Scenario retry: the payment API is unavailable on the first call; @retry:2 re-runs the whole scenario.
  @retry:2
  Scenario: Pay through a flaky API
    Given the payment API fails 1 time with "ServiceUnavailable"
    When I pay 25
    Then the payment is accepted

  # Group retry: the cache needs two warm-up passes; the group re-runs (hooks included) and dependents wait.
  @group:warmup @id:warm-cache
  Scenario: Warm the cache
    Then the cache is warm after 2 passes

  @dependsOn:group:warmup
  Scenario: Read from a warm cache
    Then the cache answers instantly

  # Known bug: runs and is reported, but cannot fail the build.
  @quarantine
  Scenario: Exact totals (BUG-123)
    Then 0.1 + 0.2 equals 0.3 exactly

  # Soft assertions: every check runs, failures are reported together at the end of the step.
  Scenario: Receipt fields
    Then the receipt has all fields

  # A time budget for the whole scenario.
  @timeout:2s
  Scenario: Finishes within its budget
    Given a step that takes 50 ms
    And a step that takes 50 ms
