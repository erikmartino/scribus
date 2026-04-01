# Testing Strategy: Scribus App Shell

To ensure high-quality and stable builds of the Scribus App Shell, we need a testing strategy that covers both the core shell logic and the isolation of consumer plugins.

## 1. Unit Testing: Core Logic (JSDOM)
- **Goal**: Test non-visual logic like the `DocumentModel`, `SelectionService`, `CommandHistory`, and `ClipboardService`.
- **Tooling**: `node --test` with `jsdom`.
- **Process**:
    - Mock the browser environment in Node using JSDOM.
    - Assert that items can be registered, selected, and command history can undo/redo properly.

## 2. Integration Testing: The "Isolated Consumer" Boundary
- **Goal**: Ensure the App Shell correctly interacts with consumer demos without breaking isolation.
- **Tooling**: Playwright or Vitest with Browser Mode.
- **Scenarios**:
    - **Selection**: Selecting an item in the `Shapes Demo` correctly updates the `Property Inspector` in the Shell.
    - **Marquee**: Multiple items in the workspace are selected after a drag-select.
    - **Clipboard**: Copying from the `Story Editor` and pasting into the `Shapes Demo` (or vice versa) results in the correct data dispatch or ignore actions.
    - **Undo/Redo**: Performing actions in a plugin are reversible through shell-level UI buttons.

## 3. Manual Verification (Now Automated)
- [x] Selection functionality (Playwright: `shapes-spec.js`, `story-spec.js`)
- [x] Marquee selection logic (Playwright: `shapes-spec.js`)
- [x] Clipboard rich sync (Node Test: `test-clipboard.js`, Playwright: `story-editor.spec.js`)
- [x] Undo/Redo stability (Node Test: `test-shell-history.js`, Playwright: `shapes-spec.js`)


## 4. Automation Recommendations
Add a `test` script to `docs/app-shell/package.json`:
```json
{
  "scripts": {
    "test": "node --test test/*.js",
    "test:e2e": "playwright test"
  }
}
```

---
Updated: 2026-04-01
Status: Proposed Testing Strategy
