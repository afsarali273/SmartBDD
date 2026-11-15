@serial
Feature: Logged-in journey
  Scenario: log in
    Given the session logs in as "ana"
  Scenario: browse
    Then the session is still "ana"
  Scenario: buy
    Then the session is still "ana"
  Scenario: log out
    Then the session is still "ana"
