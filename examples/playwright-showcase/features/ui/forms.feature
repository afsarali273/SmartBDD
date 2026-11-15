@ui @the-internet @owner:web
Feature: UI form controls

  Background:
    Given the UI base URL is configured

  Rule: Checkbox controls preserve explicit state

    @id:ui-checkbox-defaults @smoke
    Scenario: Checkbox defaults are visible
      When I open UI path "/checkboxes"
      Then checkbox 1 is unchecked
      And checkbox 2 is checked

    @id:ui-checkbox-toggle
    Scenario Outline: A checkbox can be changed
      When I open UI path "/checkboxes"
      And I set checkbox <number> to <state>
      Then checkbox <number> is <state>

      Examples:
        | number | state   |
        | 1      | checked |
        | 2      | unchecked |

  Rule: Standard form inputs accept user choices

    @id:ui-dropdown
    Scenario Outline: Dropdown options can be selected
      When I open UI path "/dropdown"
      And I select dropdown option "<option>"
      Then dropdown option "<option>" is selected

      Examples:
        | option   |
        | Option 1 |
        | Option 2 |

    @id:ui-number-input
    Scenario Outline: Number input retains its value
      When I open UI path "/inputs"
      And I enter number "<number>"
      Then the number input value is "<number>"

      Examples:
        | number |
        | 0      |
        | 42     |
        | -7     |

    @id:ui-key-press
    Scenario Outline: Keyboard events report the pressed key
      When I open UI path "/key_presses"
      And I press keyboard key "<key>"
      Then the key result contains "<result>"

      Examples:
        | key       | result |
        | Enter     | ENTER  |
        | Escape    | ESCAPE |
        | Space     | SPACE  |
        | ArrowDown | DOWN   |

  Rule: Authentication reports success and failure

    @id:ui-login-success @smoke
    Scenario: Valid credentials open the secure area
      When I open UI path "/login"
      And I log in with username "tomsmith" and password "SuperSecretPassword!"
      Then the login message contains "You logged into a secure area!"
      And the current UI path is "/secure"

    @id:ui-login-failure
    Scenario Outline: Invalid credentials are rejected
      When I open UI path "/login"
      And I log in with username "<username>" and password "<password>"
      Then the login message contains "<message>"

      Examples:
        | username | password             | message                   |
        | nobody   | SuperSecretPassword! | Your username is invalid! |
        | tomsmith | incorrect            | Your password is invalid! |

  Rule: Dynamic controls respond to interaction

    @id:ui-add-elements
    Scenario Outline: Requested delete buttons are added
      When I open UI path "/add_remove_elements/"
      And I add <count> elements
      Then <count> delete buttons are displayed

      Examples:
        | count |
        | 1     |
        | 2     |
        | 4     |

    @id:ui-slider
    Scenario: Horizontal slider reports its value
      When I open UI path "/horizontal_slider"
      And I set the horizontal slider to "3.5"
      Then the horizontal slider value is "3.5"
