@ui @the-internet @plugin @owner:web
Feature: Several browser contexts and devices in one scenario
  The newContext fixture opens extra isolated contexts: a second user, or a phone next to a desktop.

  @id:plugin-two-users
  Scenario: Two users have isolated sessions
    Given user "alice" is logged in to the secure area
    When a second browser context opens the secure area
    Then the second context is sent to the login page
    And user "alice" is still in the secure area

  @id:plugin-mobile
  Scenario Outline: The same page on a phone and a desktop
    When I open the heading page on "<device>"
    Then the heading is visible and the viewport is wider than <min> pixels

    Examples:
      | device  | min |
      | Pixel 7 | 0   |
      | Desktop | 1000 |
