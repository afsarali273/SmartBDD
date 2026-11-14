Feature: Pool

  @id:producer
  Scenario: Producer
    Given I export my process id

  @dependsOn:producer
  Scenario: Consumer
    Then I can read the producer's process id

  Scenario: Seeded run store
    Then the run store holds the BeforeAll seed

  Scenario Outline: Busy <n>
    Given I record my process id
    Examples:
      | n |
      | 1 |
      | 2 |
      | 3 |
      | 4 |

  @crash
  Scenario: Crashes when asked
    Given the worker crashes if crash=yes
