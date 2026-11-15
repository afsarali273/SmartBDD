@ui @saucedemo @owner:web
Feature: SauceDemo inventory and cart

  Background:
    Given I am signed in to SauceDemo as "standard_user"

  @id:sauce-inventory-count @smoke
  Scenario: Inventory contains the complete catalogue
    Then SauceDemo displays 6 inventory products

  @id:sauce-inventory-sort
  Scenario Outline: Inventory can be sorted
    When I sort SauceDemo inventory by "<sort>"
    Then the first SauceDemo product is "<product>"

    Examples:
      | sort                | product                                    |
      | Name (A to Z)       | Sauce Labs Backpack                        |
      | Name (Z to A)       | Test.allTheThings() T-Shirt (Red)          |
      | Price (low to high) | Sauce Labs Onesie                          |
      | Price (high to low) | Sauce Labs Fleece Jacket                   |

  @id:sauce-product-details
  Scenario Outline: Product links open the matching details page
    When I open SauceDemo product "<product>"
    Then the SauceDemo product detail name is "<product>"

    Examples:
      | product                             |
      | Sauce Labs Backpack                 |
      | Sauce Labs Bike Light               |
      | Sauce Labs Bolt T-Shirt             |

  @id:sauce-add-product
  Scenario Outline: Product can be added to the cart
    When I add SauceDemo product "<product>" to the cart
    Then the SauceDemo cart badge is 1
    And the SauceDemo cart contains "<product>"

    Examples:
      | product                 |
      | Sauce Labs Backpack     |
      | Sauce Labs Bike Light   |
      | Sauce Labs Fleece Jacket|

  @id:sauce-multiple-cart-items
  Scenario: Multiple products update the cart badge
    When I add these SauceDemo products to the cart:
      | product                 |
      | Sauce Labs Backpack     |
      | Sauce Labs Onesie       |
    Then the SauceDemo cart badge is 2
