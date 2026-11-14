Feature: Checkout

  @checkout @dependsOn:login
  Scenario Outline: Buy <product>
    Given I am logged in
    When I buy "<product>"
    Then the order is confirmed

    Examples:
      | product |
      | apple   |
      | pear    |
      | melon   |
      | fig     |
