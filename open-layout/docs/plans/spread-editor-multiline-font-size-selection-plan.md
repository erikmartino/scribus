# Plan: Preserve selection and apply font size/line height to all selected paragraphs

**Date:** 2026-06-20

## Problem

In the `spread-editor` demo:
1. Selecting multiple paragraphs and applying a font size change in the side panel only updates the style of the paragraph containing the cursor. Text in other paragraphs is unaffected.
2. The active selection highlight is reset/cleared when changing font size (or applying any style change).

## Proposed Changes

1. **`story-editor/lib/editor-state.js`**:
   - In `applyCharacterStyle`, preserve selection instead of clearing it (`this._selection = null`).
2. **`story-editor/test/test-editor-state.js`**:
   - Update tests to expect selection to be preserved when formatting is applied.
3. **`story-editor/lib/shaper.js`**:
   - Update `shapeParagraph` to respect character-level `fontSize` when shaping individual runs.
4. **`doc-renderer/lib/svg-renderer.js`**:
   - Update `svgAttrsForStyle` to output `'font-size'` on the `tspan` elements when present.
5. **`spread-editor/app/spread-editor-app.js`**:
   - In `applyFontSize` and `applyLineHeight`, update paragraph styles for all paragraphs in the selected range, not just the one with the cursor.
6. **`app-shell/lib/text-commands.js`**:
   - Apply similar paragraph style updates across the selection range when changing font size/line height under the fallback command handler.

## Status

- [x] Modify `story-editor/lib/editor-state.js`
- [x] Modify `story-editor/test/test-editor-state.js`
- [x] Modify `story-editor/lib/shaper.js`
- [x] Modify `doc-renderer/lib/svg-renderer.js`
- [x] Modify `spread-editor/app/spread-editor-app.js`
- [x] Modify `app-shell/lib/text-commands.js`
- [x] Verify via unit tests and Playwright E2E tests
