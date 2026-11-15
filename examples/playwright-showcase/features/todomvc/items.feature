@ui @todomvc @owner:web
Feature: TodoMVC item lifecycle

  Background:
    Given the TodoMVC application is open

  @id:todo-empty @smoke
  Scenario: New list starts empty
    Then TodoMVC displays 0 todo items

  @id:todo-add-one
  Scenario Outline: A todo can be added
    When I add TodoMVC item "<title>"
    Then TodoMVC displays 1 todo item
    And TodoMVC contains item "<title>"

    Examples:
      | title                  |
      | buy milk               |
      | review pull request    |
      | publish test report    |

  @id:todo-add-table
  Scenario: Several todos can be added from a table
    When I add these TodoMVC items:
      | title        |
      | write tests  |
      | run tests    |
      | ship release |
    Then TodoMVC displays 3 todo items
    And the TodoMVC counter says "3 items left"

  @id:todo-complete
  Scenario Outline: A todo can be completed
    Given TodoMVC contains items "alpha" and "<title>"
    When I complete TodoMVC item "<title>"
    Then TodoMVC item "<title>" is completed
    And the TodoMVC counter says "1 item left"

    Examples:
      | title |
      | beta  |
      | gamma |

  @id:todo-delete
  Scenario: A todo can be deleted
    Given TodoMVC contains items "keep me" and "delete me"
    When I delete TodoMVC item "delete me"
    Then TodoMVC displays 1 todo item
    And TodoMVC does not contain item "delete me"
