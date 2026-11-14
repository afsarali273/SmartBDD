@group:payments
Feature: Payments

  Scenario: Card payment
    When I pay 10 by "card"

  Scenario: Wallet payment
    When I pay 5 by "wallet"
