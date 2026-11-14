Feature: Step and scenario statuses

  Scenario: all pass
    Given a passing step
    When a passing step
    Then a passing step

  Scenario: one fails
    Given a passing step
    When a failing step
    Then a passing step

  Scenario: pending
    Given a pending step
    Then a passing step

  Scenario: undefined
    Given a passing step
    When nobody defined this step
    Then a passing step

  Scenario: skipped by step
    Given a skipping step
    Then a passing step
