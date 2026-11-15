@api @jsonplaceholder @owner:services
Feature: JSONPlaceholder read operations

  Background:
    Given the API base URL is configured

  Rule: Individual resources have stable identifiers

    @id:api-read-post @dependsOn:health-api @smoke
    Scenario Outline: Read a post by id from external CSV data
      Given health check "health-api" exported status 200
      When I GET API path "/posts/<id>"
      Then the API response status is 200
      And the API field "id" equals <id>
      And the API field "userId" equals <userId>

      @data:post-ids.csv
      Examples:
        | id | userId |

    @id:api-read-user
    Scenario Outline: Read a user by id
      When I GET API path "/users/<id>"
      Then the API response status is 200
      And the API object contains:
        | field    | value       |
        | id       | <id>        |
        | username | <username>  |

      Examples:
        | id | username  |
        | 1  | Bret      |
        | 5  | Kamren    |
        | 10 | Moriah.Stanton |

  Rule: Collections and relationships can be queried

    @id:api-collection-size
    Scenario Outline: Resource collections expose their documented size
      When I GET the <resource> API collection
      Then the API response status is 200
      And the API array contains <count> items

      Examples:
        | resource | count |
        | posts    | 100   |
        | comments | 500   |
        | albums   | 100   |
        | photos   | 5000  |
        | todos    | 200   |
        | users    | 10    |

    @id:api-filter-posts
    Scenario Outline: Posts can be filtered by owner
      When I GET API path "/posts?userId=<userId>"
      Then the API response status is 200
      And the API array contains 10 items
      And every API item has "userId" equal to <userId>

      Examples:
        | userId |
        | 1      |
        | 5      |
        | 10     |

    @id:api-nested-comments
    Scenario Outline: Nested post comments preserve their relationship
      When I GET API path "/posts/<postId>/comments"
      Then the API response status is 200
      And the API array contains 5 items
      And every API item has "postId" equal to <postId>

      Examples:
        | postId |
        | 1      |
        | 20     |
        | 100    |

    @id:api-repeat-probe
    Scenario: Concurrent repeat probes are safe for API steps
      When I probe API post {{i}} of {{n}} @repeat:3 @concurrency:3
