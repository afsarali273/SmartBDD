@ui
Feature: Log in to the shop

  Scenario: Correct password
    Given I am on the login page
    When I log in as "ana" with "secret"
    Then I see "Welcome ana"
    And the page title is "Shop login"

  Scenario: Wrong password
    Given I am on the login page
    When I log in as "ana" with "nope"
    Then I see "Wrong password"
