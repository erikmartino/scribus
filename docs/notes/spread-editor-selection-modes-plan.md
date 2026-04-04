# Implementation Plan - Spread Editor Selection Modes

Introduce two distinct selection modes to the spread editor: **Object Selection Mode** and **Text Edit Mode**. The interface will dynamically update its cursor and ribbon bar based on the active mode.

## Status: COMPLETED

All planned changes have been implemented and verified with Playwright tests.

## Completed Changes

### Core Logic

#### [spread-editor-app.js](file:///Users/martino/git/scribus/docs/spread-editor/app/spread-editor-app.js)
-   [x] Added `this.mode = 'object'` to track current mode.
-   [x] Implemented `setMode(mode)` to update `scribus-app-shell` visibility and track state.
-   [x] Refactored as a shell plugin to dynamically manage ribbon sections.
-   [x] Updated event listeners for `pointerdown`, `click`, and `dblclick` to handle mode transitions.
-   [x] Integrated text editing events (keydown, beforeinput, paste) to only be active in `text` mode.

### UI / Styling

#### [index.html](file:///Users/martino/git/scribus/docs/spread-editor/index.html)
-   [x] Added `data-mode` attribute to `scribus-app-shell` for CSS-based UI toggling.
-   [x] Moved hardcoded ribbon sections to JavaScript plugin logic for dynamic rendering.
-   [x] Implemented CSS-based cursor management.

### Component Logic

#### [box-interactions.js](file:///Users/martino/git/scribus/docs/spread-editor/app/box-interactions.js)
-   [x] Updated `onBodyClick` callback to support mode-aware selection logic.

## Verification Results

### Automated Tests (Playwright)
-   [x] Created [selection-modes.spec.js](file:///Users/martino/git/scribus/docs/spread-editor/test/selection-modes.spec.js):
    -   Verified initial mode is `object`.
    -   Verified clicking a box selects it.
    -   Verified double-clicking enters `text` mode.
    -   Verified ribbon sections toggle correctly (Geometry/Spread -> Typography/Formatting).
    -   Verified shell `data-mode` attribute updates correctly.

### Manual Verification
-   Verified pointer cursor behavior (`default` vs `text`).
-   Confirmed typing and formatting work as expected in text mode.
-   Confirmed clicking background returns editor to object selection mode.
