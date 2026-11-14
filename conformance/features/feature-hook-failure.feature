@fail-feature
Feature: A failing BeforeFeature hook skips the feature

  Scenario: never runs
    Given I record "should not appear"

  Scenario: never runs either
    Given a passing step
