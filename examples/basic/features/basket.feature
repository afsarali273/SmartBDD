@shop
Feature: Shopping basket
  Customers add products to a basket and pay the total.

  Background:
    Given the catalogue:
      | product | price |
      | apple   | 0.50  |
      | pear    | 0.75  |
      | melon   | 3.00  |
    And an empty basket

  @smoke @id:add-single
  Scenario: Add a single product
    When I add 2 "apple"
    Then the basket total is 1.00

  Scenario Outline: Totals for different quantities
    When I add <qty> "<product>"
    Then the basket total is <total>

    @fast
    Examples: cheap
      | qty | product | total |
      | 1   | apple   | 0.50  |
      | 4   | pear    | 3.00  |

    Examples: expensive
      | qty | product | total |
      | 2   | melon   | 6.00  |

  @owner:payments
  Rule: Discount codes reduce the total

    Scenario: Ten percent off
      Given the discount code "TEN" is active
      When I add 2 "melon"
      Then the basket total is 5.40

    @wip
    Scenario: Stacking codes is not allowed yet
      Given the discount code "TEN" is active
      And the discount code "FIVE" is active
      Then I see the error "Only one code per basket"
