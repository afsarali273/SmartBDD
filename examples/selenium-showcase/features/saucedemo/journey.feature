@ui @saucedemo @journey @serial @reuseSession @owner:web
Feature: A shopping journey in ONE browser session
  The scenarios run in order on one browser: signing in happens once, and every later scenario continues on the same
  page with the same cart. (@serial keeps them in file order, @reuseSession shares the browser session.)

  Scenario: Sign in
    Given the SauceDemo login page is open
    When I sign in to SauceDemo as "standard_user" with password "secret_sauce"
    Then the SauceDemo inventory page is displayed
    And SauceDemo displays 6 inventory products

  Scenario: Sort the catalogue (still signed in)
    When I sort SauceDemo inventory by "Price (low to high)"
    Then the first SauceDemo product is "Sauce Labs Onesie"

  Scenario: Fill the cart (same page)
    When I add these SauceDemo products to the cart:
      | product               |
      | Sauce Labs Backpack   |
      | Sauce Labs Bike Light |
    Then the SauceDemo cart badge is 2

  Scenario: The cart holds what was added
    Then the SauceDemo cart contains:
      | product               |
      | Sauce Labs Backpack   |
      | Sauce Labs Bike Light |
