@health @owner:platform
Feature: Public target health
  The public demo systems must be reachable before dependent UI and API groups start.

  @id:health-ui @smoke
  Scenario: UI target is available
    When I check the "ui" target
    Then the health response status is 200
    And I export the successful health check

  @id:health-api @smoke
  Scenario: API target is available
    When I check the "api" target
    Then the health response status is 200
    And I export the successful health check

  @id:framework-retry @retry:1
  Scenario: Scenario retry recovers from a controlled transient failure
    When a controlled transient step runs
    Then the scenario attempt is 2

  @id:health-additional-targets @smoke
  Scenario Outline: Additional public target is available
    When I check the "<target>" target
    Then the health response status is 200

    Examples:
      | target    |
      | saucedemo |
      | todomvc   |
      | dummyjson |
