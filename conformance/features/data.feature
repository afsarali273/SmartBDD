Feature: External data

  @data:fruit.csv?colour=green
  Scenario: from csv <fruit>
    Given I record "<fruit> costs <price>"

  Scenario Outline: examples filled from csv
    Given I record the row value "name"

    @data:fruit.csv?rows=1,3 @dataField:name=fruit
    Examples:
      | name |
