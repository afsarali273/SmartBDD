Feature: Rerun
  Scenario: always fine
    Given ok
  @id:flaky
  Scenario: depends on the environment
    Given the backend is up
  @dependsOn:flaky
  Scenario: downstream
    Given ok
