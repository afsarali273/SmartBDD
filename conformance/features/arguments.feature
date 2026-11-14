Feature: Step arguments

  Scenario: data table
    Given the table has 2 rows
      | name | role  |
      | ann  | admin |
      | bob  | user  |

  Scenario: doc string
    Given the doc string says "hello world"
      """
      hello world
      """

  Scenario: timing
    Given a step that sleeps 5 ms
