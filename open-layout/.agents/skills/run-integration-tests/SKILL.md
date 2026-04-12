# Run All Integration Tests Skill

This skill allows the agent to run all end-to-end (E2E) and integration tests for the project using Playwright.

## Instructions

1.  **Preparation**: Ensure the dev server is running if the tests require it. (The Playwright config is usually set to start the server automatically if needed).
2.  **Execution**: Run the following command from the project root:
    ```bash
    npx playwright test
    ```
3.  **Reporting**: 
    -   If tests fail, check the `BROWSER [error]` or `SyntaxError` logs in the terminal output as per `AGENTS.md`.
    -   The report is usually generated in `playwright-report/index.html`.
4.  **Verification**: Confirm "No console errors found" in the browser logs for all passed tests.

## Usage

Use this skill whenever you need to verify that your changes haven't introduced regressions across the application shell, story editor, or spread editor.
