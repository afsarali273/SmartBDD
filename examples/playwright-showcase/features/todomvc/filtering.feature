@ui @todomvc @owner:web
Feature: TodoMVC filtering and persistence

  Background:
    Given the TodoMVC application is open
    And TodoMVC contains items "active one", "completed one" and "active two"
    And I complete TodoMVC item "completed one"

  @id:todo-filter
  Scenario Outline: List filters show the expected items
    When I select TodoMVC filter "<filter>"
    Then TodoMVC displays <count> visible todo items

    Examples:
      | filter    | count |
      | All       | 3     |
      | Active    | 2     |
      | Completed | 1     |

  @id:todo-clear-completed
  Scenario: Completed todos can be cleared
    When I clear completed TodoMVC items
    Then TodoMVC displays 2 todo items
    And TodoMVC does not contain item "completed one"

  @id:todo-toggle-all
  Scenario: All todos can be completed together
    When I mark all TodoMVC items complete
    Then TodoMVC displays 3 completed items

  @id:todo-edit
  Scenario: A todo title can be edited
    When I rename TodoMVC item "active one" to "renamed item"
    Then TodoMVC contains item "renamed item"
    And TodoMVC does not contain item "active one"

  @id:todo-persistence
  Scenario: Todos persist after page reload
    When I reload TodoMVC
    Then TodoMVC displays 3 todo items
    And TodoMVC item "completed one" is completed
