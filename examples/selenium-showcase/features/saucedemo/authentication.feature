@ui @saucedemo @auth @owner:web
Feature: SauceDemo authentication

  Background:
    Given the SauceDemo login page is open

  @smoke
  Scenario Outline: Valid users can sign in
    When I sign in to SauceDemo as "<username>" with password "secret_sauce"
    Then the SauceDemo inventory page is displayed

    Examples:
      | username                |
      | standard_user           |
      | problem_user            |
      | performance_glitch_user |

  Scenario: A locked-out user is rejected
    When I sign in to SauceDemo as "locked_out_user" with password "secret_sauce"
    Then the SauceDemo login error contains "Sorry, this user has been locked out"
