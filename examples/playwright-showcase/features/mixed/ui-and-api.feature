@mixed @ui @api @owner:web
Feature: UI and API in the same scenario
  Each scenario uses the browser (Playwright plugin: `page`) and plain HTTP (axios plugin: `api`) together.
  Data and sessions move between the two through the scenario state.

  Rule: API data drives the UI

    Scenario Outline: A post title fetched through the API becomes a todo in the browser
      When I fetch the title of post <id> through the API
      And I add that title as a todo in TodoMVC
      Then TodoMVC lists that title
      And the TodoMVC counter says "1 item left"

      Examples:
        | id |
        | 1  |
        | 2  |
        | 3  |

  Rule: API and browser agree

    Scenario Outline: The API and the browser see the same status code page
      When I request the status code page <code> through the API
      Then the API status is <code>
      When I open the status code page <code> in the browser
      Then the browser page reports status code <code>

      Examples:
        | code |
        | 200  |
        | 404  |
        | 500  |

  Rule: Credentials and sessions cross between API and browser

    Scenario: HTTP basic auth is enforced for both
      Then the API gets 401 from the protected page without credentials
      And the API gets 200 from the protected page with credentials "admin" and "admin"
      And a browser context with credentials "admin" and "admin" sees the congratulations page

    Scenario: A browser login session authorises an API call
      Given I log in through the browser as "tomsmith" with password "SuperSecretPassword!"
      Then the API call carrying the browser's cookies reaches the secure area
      And the API call without the cookies is redirected to the login page
