@ui @saucedemo @owner:web
Feature: SauceDemo authentication
  Authentication scenarios are intentionally in the serial SauceDemo group.

  Background:
    Given the SauceDemo login page is open

  @id:sauce-valid-user @smoke
  Scenario Outline: Valid users can sign in
    When I sign in to SauceDemo as "<username>" with password "secret_sauce"
    Then the SauceDemo inventory page is displayed

    Examples:
      | username                |
      | standard_user           |
      | problem_user            |
      | performance_glitch_user |

  @id:sauce-locked-user
  Scenario: Locked user is rejected
    When I sign in to SauceDemo as "locked_out_user" with password "secret_sauce"
    Then the SauceDemo login error contains "Sorry, this user has been locked out"

  @id:sauce-invalid-login
  Scenario Outline: Invalid credentials show a useful validation message
    When I sign in to SauceDemo as "<username>" with password "<password>"
    Then the SauceDemo login error contains "<message>"

    Examples:
      | username      | password     | message                            |
      | unknown_user  | secret_sauce | Username and password do not match |
      |               | secret_sauce | Username is required               |
      | standard_user |              | Password is required               |

  @id:sauce-logout
  Scenario: Signed-in user can log out
    When I sign in to SauceDemo as "standard_user" with password "secret_sauce"
    And I log out of SauceDemo
    Then the SauceDemo login page is displayed
