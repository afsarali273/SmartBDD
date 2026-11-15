@ui @the-internet @forms @owner:web
Feature: Form controls

  Rule: Checkboxes keep the state the user sets

    @smoke
    Scenario: Checkbox defaults
      Given I open "/checkboxes"
      Then checkbox 1 is unchecked
      And checkbox 2 is checked

    Scenario Outline: A checkbox can be changed
      Given I open "/checkboxes"
      When I set checkbox <number> to <state>
      Then checkbox <number> is <state>

      Examples:
        | number | state     |
        | 1      | checked   |
        | 2      | unchecked |

  Rule: Other inputs accept the user's choices

    Scenario Outline: Dropdown options can be selected
      Given I open "/dropdown"
      When I select dropdown option "<option>"
      Then dropdown option "<option>" is selected

      Examples:
        | option   |
        | Option 1 |
        | Option 2 |

    Scenario Outline: The number input retains its value
      Given I open "/inputs"
      When I enter number "<number>"
      Then the number input value is "<number>"

      Examples:
        | number |
        | 0      |
        | 42     |
        | -7     |

    Scenario Outline: Key presses are reported
      Given I open "/key_presses"
      When I press keyboard key "<key>"
      Then the key result contains "<result>"

      Examples:
        | key    | result |
        | Enter  | ENTER  |
        | Escape | ESCAPE |
        | Space  | SPACE  |
