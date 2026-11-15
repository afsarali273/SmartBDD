@ui @the-internet @dynamic @owner:web
Feature: Dynamic content and explicit waits
  These scenarios need the plugin's `wait` fixture: nothing is there until the page has done its work.

  Scenario: Elements can be added
    Given I open "/add_remove_elements/"
    When I add 3 elements
    Then 3 delete buttons are displayed

  Scenario: An added element can be removed
    Given I open "/add_remove_elements/"
    When I add 2 elements
    And I remove one element
    Then 1 delete buttons are displayed

  Scenario Outline: Hidden content appears after loading
    Given I open "/dynamic_loading/<example>"
    When I start the dynamic loading
    Then the loaded text is "Hello World!"

    Examples:
      | example |
      | 1       |
      | 2       |

  Scenario: A disabled input is enabled by the page
    Given I open "/dynamic_controls"
    Then the text input is disabled
    When I enable the text input
    Then the text input becomes enabled
