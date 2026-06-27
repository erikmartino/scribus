# Layers Panel UX Enhancements Plan

This plan describes how to enhance the Layers side panel to support type-specific icons, multi-selection (via Ctrl/Cmd and Shift-click), and visual distinction between primary and secondary selections.

## Proposed Changes

### App Shell

#### [MODIFY] [selection-service.js](file:///home/martino/git/scribus/open-layout/app-shell/lib/selection-service.js)
Add a `selectMany(items)` method to batch-select multiple items and dispatch a single `'replace'` change event.

#### [MODIFY] [shell-core.js](file:///home/martino/git/scribus/open-layout/app-shell/lib/shell-core.js)
*   Implement `_getItemIconSvg(type)` to return clean inline SVG icons for text frames, image frames, shapes (rect, ellipse, triangle), and generic layers.
*   Update `_renderLayersPanel(container)`:
    *   Replace the solid color swatch with the type icon colored with the item's custom style color.
    *   Maintain `this._lastClickedId` on the `AppShell` instance.
    *   Implement Shift+click range selection and Ctrl/Cmd+click selection toggling.
    *   Add distinct CSS classes: `.selected` for all selected items and `.primary-selected` for the primary active selected item.

#### [MODIFY] [shell.css](file:///home/martino/git/scribus/open-layout/app-shell/css/shell.css)
*   Update `.layers-list .layer-item` styles.
*   Add styling for `.layers-list .layer-item.selected` (subtle light highlight).
*   Add styling for `.layers-list .layer-item.primary-selected` (prominent border-left accent line and background tint).
*   Style `.layer-icon-wrapper` to size inline SVG elements correctly.

## Verification Plan

### Automated Tests
*   Run unit tests `CI=true pnpm test --run` to verify core functions.
*   Run E2E tests `CI=true pnpm test:e2e` to verify the Layers panel selection flow (`properties-panel.spec.js`).

### Manual Verification
*   Open the workspace, create multiple objects, and verify that:
    *   The Layers panel shows icons matching each shape/frame type.
    *   Ctrl/Cmd+clicking multiple layers selects them concurrently.
    *   Shift+clicking ranges selects multiple elements in the list.
    *   The primary selected element is visually distinguished with a bold left border.
