@api
Feature: Shop API

  Scenario: Health
    When I GET "/api/health"
    Then the status is 200

  Scenario: Products
    When I GET "/api/products"
    Then the status is 200
    And there are 2 products
