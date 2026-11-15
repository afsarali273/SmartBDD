@ui @the-internet @auth @owner:web
Feature: Log in to the secure area
  Authentication scenarios on the-internet.herokuapp.com, driven through a page object.

  Background:
    Given I open "/login"

  @id:sel-login-success @smoke
  Scenario: Valid credentials open the secure area
    When I log in with username "tomsmith" and password "SuperSecretPassword!"
    Then the flash message contains "You logged into a secure area!"
    And the current path is "/secure"

  Scenario Outline: Invalid credentials are rejected
    When I log in with username "<username>" and password "<password>"
    Then the flash message contains "<message>"
    And the current path is "/login"

    Examples:
      | username | password | message                  |
      | tomsmith | wrong    | Your password is invalid |
      | nobody   | whatever | Your username is invalid |

  @id:sel-logout
  Scenario: Logging out returns to the login page
    When I log in with username "tomsmith" and password "SuperSecretPassword!"
    And I log out
    Then the flash message contains "You logged out of the secure area!"
    And the current path is "/login"
