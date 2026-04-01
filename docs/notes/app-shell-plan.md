# Plan: Reusable App Shell for Scribus Demos

Date: 2026-03-29

## Objective
Create a self-contained, high-fidelity app shell in `docs/app-shell/` that provides a standard ribbon interface, right-side panels, and a fullscreen-capable fixed layout. The shell will use a plugin-based architecture to allow different demos to provide their own ribbon content and panels.

## 1. Directory Structure
- `docs/app-shell/`
  - `index.html`: Entry point (shell container).
  - `css/`
    - `shell.css`: Core layout (ribbon, panels, main body).
    - `theme.css`: Aesthetic definitions (colors, typography).
  - `lib/`
    - `shell-core.js`: Plugin registry, layout state, selection management.
    - `selection-service.js`: Bus for selection changes.
  - `plugins/`
    - `basic-demo/`
      - `plugin.js`: Simple plugin that responds to selection.

## 2. Core Layout Design
- **Body**: `overflow: hidden` to prevent window scrolling.
- **App Shell Grid**:
  - `grid-template-areas: "ribbon ribbon" "main panels"`.
  - `grid-template-rows: auto 1fr`.
  - `grid-template-columns: 1fr auto`.
- **Ribbon**: Fixed at top, height determined by content.
- **Panels**: Fixed at right, scrollable if needed.
- **Main Body**: Centered or filled scrollable area for content.
- **Fullscreen**: Browser Fullscreen API integration.

## 3. Plugin Architecture
The shell will expose a `Shell` object that plugins can use to:
- `registerRibbonTab(id, label, contentBuilder)`: Add a tab to the ribbon.
- `registerPanel(id, title, contentBuilder)`: Add a side panel.
- `subscribeToSelection(callback)`: Listen for app-wide selection changes.

## 4. Implementation Steps
### Phase 1: Foundation
- [x] Create `docs/app-shell/css/shell.css` with the fixed layout.
- [x] Create `docs/app-shell/index.html` with the basic DOM structure.
- [x] Implement fullscreen toggle.

### Phase 2: Shell Logic & Architecture
- [x] Create `docs/app-shell/lib/shell-core.js`.
- [x] Implement the `PluginRegistry` to manage ribbon tabs and panels.
- [x] Implement the `SelectionService` to broadcast changes.

### Phase 3: Selection-Aware Ribbon
- [x] Logic to swap ribbon content/visibility based on the current selection's properties.

### Phase 4: Basic Demo Application
- [x] Create a "Shapes" demo plugin.
- [x] Selection: Click on different shapes on the main stage.
- [x] Ribbon: Shows "Shape Tools" if a shape is selected, "Stage Tools" otherwise.
- [x] Panels: Property inspector for the selected shape.

## 5. Verification
- [x] Run via local server and verify layout resizing.
- [x] Test panel expansion/collapse.
- [x] Validate that selecting an item updates the ribbon correctly.
