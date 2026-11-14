Feature: Dependencies and groups

  @id:setup @group:setup
  Scenario: setup
    Given I record "setup"

  @id:broken @group:setup
  Scenario: broken
    Given a failing step

  @dependsOn:setup
  Scenario: needs setup
    Given I record "needs setup"

  @dependsOn:broken
  Scenario: needs broken
    Given I record "must not run"

  @dependsOn:broken:soft
  Scenario: soft on broken
    Given I record "soft ran"

  @priority:-1
  Scenario: urgent
    Given I record "urgent"
