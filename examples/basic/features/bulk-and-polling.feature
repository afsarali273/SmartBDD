Feature: Bulk data and polling (step-level @repeat / @retry)

  Scenario: Create 100 users, 10 at a time
    Given I create user "user-{{i}}" with email "user{{i}}@example.com" @repeat:100 @concurrency:10
    Then there are 100 users

  Scenario: Wait for an export job to finish
    Given an export job that needs 3 checks
    Then the export job is done @retry:5 @delay:50ms @backoff:2
