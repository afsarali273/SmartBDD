@shop @data-driven
Feature: Pricing from data files

  Background:
    Given the catalogue:
      | product | price |
      | apple   | 0.50  |
      | pear    | 0.75  |
      | melon   | 3.00  |
    And an empty basket

  # One scenario per CSV row. With --profile qa, data/qa/prices.csv is used instead.
  @data:prices.csv
  Scenario: <qty> x <product> costs <total>
    When I add <qty> "<product>"
    Then the basket total is <total>

  # Examples filled from an Excel sheet; only rows marked active=yes.
  Scenario Outline: Excel row: <item>
    When I add <qty> "<item>"
    Then the basket total is <total>

    @data:prices.xlsx#Basket?active=yes @dataField:item=product
    Examples:
      | item | qty | total |
