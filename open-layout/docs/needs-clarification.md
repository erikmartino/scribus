# Needs Clarification: Project Scope & Non-Goals

This document defines the boundaries of the `open-layout` prototype, detailing what is explicitly deferred or marked as out-of-scope (non-goals).

## 1. Project Scope: US English Only

Only US English text layout is a goal for this project.
*   **UI Language**: The application shell and components are permanently English-only.
*   **Geometries & Templates**: Page sizes default to US Letter, and measurements are locked to standard desktop publishing units (points/inches/picas). Metric conversion (millimeters/centimeters) is out of scope.
*   **Hyphenation**: The layout engine only loads the standard US English hyphenation patterns (`/vendor/hyphen/en.js`).
*   **Smart Quotes**: Only US-style double curly quotes (`“` / `”`) and single curly quotes (`‘` / `’`) are supported.
*   **Formatting**: Numbers use period decimal separators (`.`), commas represent thousands separators, and dates are formatted as `MM/DD/YYYY`.

## 2. Active Non-Goals

### Tab Behavior Policy
Custom tab stops or indentation rules (`Tab`/`Shift+Tab` formatting) are a non-goal. The editor defaults strictly to standard browser focus traversal.

### Bidirectional (BiDi) Text & Complex Scripts
*   Bidirectional text layout rules (selection direction, visual caret ordering, arrow key behavior) are a non-goal.
*   Non-Latin scripts requiring custom or specialized line-breaking or justification algorithms (e.g., dictionary-based Thai word-breaking, kashida justification, or complex Brahmic layout structures) are a non-goal. Non-Latin scripts are only supported if they conform to standard Latin spacing and justification rules.

### Keyboard Accent Compositions & IME
Custom handling of composition event loops (`compositionstart`/`compositionend`) and visual preedit text rendering overlays are non-goals. The editor supports only standard native browser keyboard and input event sequences.

