@api @dummyjson @owner:services
Feature: DummyJSON users

  Background:
    Given the DummyJSON API base URL is configured

  @id:dummy-user
  Scenario Outline: User can be read by id
    When I GET DummyJSON path "/users/<id>"
    Then the API response status is 200
    And the API field "id" equals <id>
    And the API field "email" is not empty

    Examples:
      | id  |
      | 1   |
      | 15  |
      | 30  |

  @id:dummy-user-search
  Scenario Outline: Users can be searched by name
    When I GET DummyJSON path "/users/search?q=<query>"
    Then the API response status is 200
    And the API nested array "users" has at least 1 item
    And some API item in "users" contains "<query>" in field "firstName"

    Examples:
      | query |
      | Emily |
      | John  |

  @id:dummy-user-gender
  Scenario Outline: Users can be filtered by gender
    When I GET DummyJSON path "/users/filter?key=gender&value=<gender>"
    Then the API response status is 200
    And the API nested array "users" has at least 1 item
    And every API item in "users" has "gender" equal to "<gender>"

    Examples:
      | gender |
      | male   |
      | female |
