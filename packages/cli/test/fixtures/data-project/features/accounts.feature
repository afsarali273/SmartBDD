Feature: Accounts
  @data:accounts.csv
  Scenario: <user> has a balance
    Then <user> has <balance>

  @data:nope.csv
  Scenario: broken data
    Then x has 1
