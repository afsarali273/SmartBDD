@ui @serial @reuseSession
Feature: One browser session for the whole journey
  The scenarios run in order on ONE browser session: the second scenario continues
  where the first left off, without opening a new browser or logging in again.

  Scenario: Log in once
    Given I am on the login page
    When I log in as "ben" with "secret"
    Then I see "Welcome ben"

  Scenario: Still logged in on the same page
    Then I see "Welcome ben"
    And the page title is "Shop login"

  Scenario: A second session has its own state
    Then a second browser session is not logged in
    And I see "Welcome ben"
