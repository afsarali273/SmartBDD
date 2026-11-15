@ui @serial @reuseContext
Feature: One browser session for the whole journey
  The scenarios run in order on ONE browser context and page: the second scenario
  continues where the first left off, without logging in again.

  Scenario: Log in once
    Given I am on the login page
    When I log in as "ben" with "secret"
    Then I see "Welcome ben"

  Scenario: Still logged in on the same page
    Then I see "Welcome ben"
    And the page title is "Shop login"
