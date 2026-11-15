@ui @independent @owner:framework
Feature: Independent Playwright documentation checks
  These UI scenarios intentionally have no named group and run unconstrained by group scheduling.

  Background:
    Given the independent Playwright documentation site is open

  @id:independent-ui-home-title
  Scenario: Playwright homepage has a product title
    Then the independent UI title contains "Playwright"

  @id:independent-ui-installation-heading
  Scenario: Playwright installation documentation has an installation heading
    When I open the independent Playwright documentation path "/docs/intro"
    Then the independent UI heading is "Installation"

  @id:independent-ui-getting-started
  Scenario: Homepage links to the getting started guide
    When I open the Playwright getting started guide
    Then the independent UI path is "/docs/intro"
