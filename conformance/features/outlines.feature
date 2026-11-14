Feature: Scenario outlines

  @id:fruit
  Scenario Outline: record <fruit>
    Given I record the row value "fruit"
    And I record "<fruit> costs <price>"

    Examples: first
      | fruit | price |
      | apple | 1     |

    @second
    Examples: second
      | fruit | price |
      | pear  | 2     |
      | plum  | 3     |

  Scenario Outline: no id tag
    Given I record the row value "n"

    Examples:
      | n |
      | 7 |
