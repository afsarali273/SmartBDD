@trace-hooks
Feature: Hook order and failures

  Background:
    Given I record "background"

  Scenario: first
    When I record "first body"

  @fail-before
  Scenario: before fails
    When I record "must not run"

  Rule: grouped
    Scenario: in rule
      When I record "rule body"
