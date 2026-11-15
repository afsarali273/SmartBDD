@api @dummyjson @owner:services
Feature: DummyJSON product catalogue

  Background:
    Given the DummyJSON API base URL is configured

  @id:dummy-product
  Scenario Outline: Product can be read by id
    When I GET DummyJSON path "/products/<id>"
    Then the API response status is 200
    And the API field "id" equals <id>
    And the API field "title" is not empty

    Examples:
      | id  |
      | 1   |
      | 50  |
      | 100 |

  @id:dummy-product-search
  Scenario Outline: Products can be searched
    When I GET DummyJSON path "/products/search?q=<query>"
    Then the API response status is 200
    And the API nested array "products" has at least 1 item
    And some API item in "products" contains "<query>" in field "title"

    Examples:
      | query  |
      | phone  |
      | laptop |

  @id:dummy-product-category
  Scenario Outline: Product categories return matching items
    When I GET DummyJSON path "/products/category/<category>"
    Then the API response status is 200
    And the API nested array "products" has at least 1 item
    And every API item in "products" has "category" equal to "<category>"

    Examples:
      | category    |
      | smartphones |
      | groceries   |

  @id:dummy-product-pagination @smoke
  Scenario: Products support pagination
    When I GET DummyJSON path "/products?limit=5&skip=10"
    Then the API response status is 200
    And the API nested array "products" contains 5 items
    And the API field "skip" equals 10
