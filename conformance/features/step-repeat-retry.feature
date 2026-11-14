Feature: Step-level repeat and retry

  Scenario: repeat with iteration placeholders
    Given I record "item {{i}} of {{n}}" @repeat:3

  Scenario: retry until it passes
    Given a step that passes on attempt 3 @retry:5

  Scenario: retry gives up
    Given a step that passes on attempt 9 @retry:2
    Then I record "must not run"

  Scenario: repeat stops at the first failure
    Given a step that fails on repetition 2 @repeat:5
