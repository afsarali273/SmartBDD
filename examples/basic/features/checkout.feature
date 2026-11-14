@shop
Feature: Checkout (class-based steps)

  Scenario: Pay for a basket
    Given a customer with 20.00 in their wallet
    When they pay 7.50
    Then their wallet has 12.50 left
    And a receipt was issued
