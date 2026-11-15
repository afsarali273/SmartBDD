Feature: Products API
  API checks with the axios plugin: no browser, no HTTP code of our own in the steps.

  Scenario: List the products
    When I GET "/products"
    Then the status is 200
    And the list contains 1 products

  Scenario: Create, read and delete a product
    When I create product "pear" with price 0.75
    Then the status is 201
    And the response has:
      | field | value |
      | name  | pear  |
      | price | 0.75  |
    When I delete the created product
    Then the status is 204

  Scenario: Validation errors are plain data
    When I create a product without a name
    Then the status is 400

  Scenario: Unknown products are a 404, not an exception
    When I GET "/products/999"
    Then the status is 404

  Scenario: The API needs a token
    When I GET "/products" without a token

  Scenario: Another client with a wrong token is rejected
    Given another client with token "nope"
    Then that client is rejected with 401
