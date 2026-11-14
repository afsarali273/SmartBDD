@group:setup
Feature: Environment setup

  @id:create-user
  Scenario: Create a test user
    Given I create user "ann"

  @id:login @dependsOn:create-user
  Scenario: Log in
    When I log in as "ann"
