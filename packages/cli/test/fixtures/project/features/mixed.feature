Feature: Mixed results

  @green
  Scenario: passes
    Given the env is "local"

  Scenario: fails
    Given the env is "prod"

  Scenario: undefined
    Given something nobody wrote

  @wip
  Scenario: work in progress
    Given something nobody wrote
