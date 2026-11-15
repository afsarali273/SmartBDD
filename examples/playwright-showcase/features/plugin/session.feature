@ui @saucedemo @plugin @serial @reuseContext @owner:web
Feature: One browser session for a whole journey
  A @serial feature with @reuseContext keeps one browser context and page for all its scenarios: the user signs in once
  and the later scenarios continue in the same session.

  @id:plugin-session-login
  Scenario: Sign in once
    Given the SauceDemo login page is open
    When I sign in to SauceDemo as "standard_user" with password "secret_sauce"
    Then the SauceDemo inventory page is displayed

  @id:plugin-session-shop
  Scenario: Still signed in, add products
    Then the SauceDemo inventory page is displayed
    When I add SauceDemo product "Sauce Labs Backpack" to the cart
    Then the SauceDemo cart badge is 1

  @id:plugin-session-cart
  Scenario: Same session, the cart is still filled
    Then the SauceDemo cart badge is 1
    And the SauceDemo cart contains "Sauce Labs Backpack"
