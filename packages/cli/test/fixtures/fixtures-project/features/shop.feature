Feature: Shop with fixtures

  @group:checkout @id:co-1
  Scenario: checkout one
    Given I am on the checkout page
    Then the checkout url is shown

  @group:checkout
  Scenario: checkout two
    Given I am on the checkout page
    Then the checkout url is shown

  @group:search
  Scenario: search a
    Given the shop is open at "/search?q=a"
    Then the url ends with "q=a"

  @group:search
  Scenario: search b
    Given the shop is open at "/search?q=b"
    Then the url ends with "q=b"

  @dependsOn:co-1
  Scenario: after checkout
    Given the shop is open at "/orders"
    Then the url ends with "/orders"

  @retry:1
  Scenario: flaky
    Given the shop is open at "/flaky"
    When a flaky click happens
    Then the url ends with "/flaky"

  Scenario: no browser needed
    Given nothing browser related
