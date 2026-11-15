@ui
Feature: Log in to the shop

  @group:checkout
  Scenario: Correct password
    Given I am on the login page
    When I log in as "ana" with "secret"
    Then I see "Welcome ana"
    And the page title is "Shop login"

  @group:checkout
  Scenario: Wrong password
    Given I am on the login page
    When I log in as "ana" with "nope"
    Then I see "Wrong password"
