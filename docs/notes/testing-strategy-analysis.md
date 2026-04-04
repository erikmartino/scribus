# Testing Strategy Analysis

Date: 2026-04-04

## Current State

### Unit Tests (Node.js `node:test`)

| File | Module Under Test | What It Covers |
|------|-------------------|----------------|
| `story-editor/test/test-story-ops.js` | `story-ops.js` | Pure text mutation: insert, delete, split, merge, style application, range ops |
| `story-editor/test/test-editor-state.js` | `editor-state.js` | Editor state machine: beforeinput handling, keydown fallback, selection, word navigation, undo snapshots |
| `story-editor/test/test-cursor.js` | `cursor.js` | Cursor click mapping, ArrowUp/Down sticky column (with DOM mocks) |
| `story-editor/test/test-positions.js` | `positions.js` | Glyph-to-character position mapping, ligature clusters |
| `story-editor/test/test-story-position.js` | `story-position.js` | Cursor movement (left/right/wrap), point-to-position mapping, line boundary disambiguation |
| `story-editor/test/test-layout-engine.js` | `layout-engine.js` | Paragraph shaping, shaping cache, box overflow flow, per-paragraph styles |
| `story-editor/test/test-line-breaker.js` | `line-breaker.js` | Line breaking on space/soft-hyphen |
| `story-editor/test/test-justifier.js` | `justifier.js` | Full justification vs. natural spacing |
| `story-editor/test/test-hyphenator.js` | `hyphenator.js` | Hyphenation with style preservation |
| `story-editor/test/test-font-registry.js` | `font-registry.js` | Font loading, variant registration, FontFace API |
| `story-editor/test/test-style.js` | `style.js` | Style comparison and cloning |
| `story-editor/test/test-text-extract.js` | `text-extract.js` | HTML-to-story conversion |
| `story-editor/test/test-lineMap-cursor-integration.js` | `positions.js` + `story-position.js` | Round-trip cursor positioning through ligatures/hyphens |
| `story-editor/test/test-story-editor-plugin.js` | `story-editor-plugin.js` | Plugin lifecycle: command registration, undo/redo, paste handling |
| `app-shell/test/test-shell-logic.js` | `document-model.js`, `selection-service.js` | Document model CRUD, selection state management |
| `app-shell/test/test-shell-history.js` | `command-manager.js` | Undo/redo stack behavior |
| `app-shell/test/test-clipboard.js` | `clipboard-service.js` | Rich paste from localStorage, plain-text fallback |
| `spread-editor/test/test-spread-editor-app.js` | `spread-editor-app.js` | Mode switching (object/text), ribbon section visibility per mode |
| `font-manager/test/test-google-font-manager.js` | `google-font-manager.js` | Catalog loading, font resolution, style normalization |

### Playwright Tests (E2E, browser)

| File | What It Tests |
|------|---------------|
| `app-shell/test/story-editor.spec.js` | Typing + undo, bold + undo, copy/paste + undo, font-size panel sync |
| `app-shell/test/clipboard.spec.js` | Cut removes text + populates system clipboard, paste restores |
| `app-shell/test/trailing-space.spec.js` | Cursor advances when space typed at paragraph end |
| `app-shell/test/rocking-text.spec.js` | Text positions remain stable when appending words |
| `app-shell/test/focus-preservation.spec.js` | Editor keeps focus after Bold button click, after font family change |
| `app-shell/test/shapes-demo.spec.js` | Shape selection, marquee, copy/paste, delete+undo in shapes demo |
| `app-shell/test/spread-editor.spec.js` | Spread editor loads without console errors |
| `app-shell/test/repro-ribbon-wrap.spec.js` | Ribbon section labels, redundant label removal |
| `spread-editor/test/gestures.spec.js` | Double-click text mode, word selection, drag selection, font family change, clipboard in text mode |
| `spread-editor/test/selection-modes.spec.js` | Object/text mode transitions, background click exit, text drag selection, userSelect CSS |

---

## Analysis: What Playwright Tests Could Be Unit Tests

### HIGH value candidates for conversion

#### 1. `story-editor.spec.js` - "typing inserts text and undo removes it as a group"
**Current**: Types "ZQX" into browser SVG, checks innerHTML, then Ctrl+Z.
**Assessment**: The core behavior (insert text, then undo restoring previous state) is already tested in `test-editor-state.js` and `test-story-editor-plugin.js`. The Playwright test adds value only by verifying the full rendering pipeline (WASM shaper -> SVG). The undo/redo logic itself does not need Playwright.
**Recommendation**: Keep as smoke test, but the undo grouping logic should have a dedicated unit test in `test-editor-state.js` if not already present.

#### 2. `story-editor.spec.js` - "bold styling can be undone via Ctrl+Z"
**Current**: Select all -> Ctrl+B -> verify bold attributes -> Ctrl+Z -> verify restored.
**Assessment**: `test-editor-state.js` already covers `applyCharacterStyle` and `getState/setState` snapshots. The Playwright test only adds SVG rendering verification. The bold toggle + undo logic is unit-testable.
**Recommendation**: Already adequately unit-tested. The Playwright test is a rendering regression test.

#### 3. `story-editor.spec.js` - "copy and paste duplicates content"
**Current**: Select all -> copy -> verify localStorage -> paste -> verify more tspans -> undo.
**Assessment**: `test-clipboard.js` already tests `_handlePaste` with localStorage. `test-story-editor-plugin.js` tests `handlePaste`. The Playwright test adds clipboard API integration and SVG rendering verification.
**Recommendation**: The localStorage clipboard verification (line 79-83) is pure logic already unit-tested. Keep Playwright for system clipboard integration only.

#### 4. `story-editor.spec.js` - "font size in properties panel reflects current paragraph style"
**Current**: Checks that `<scribus-input#font-size>` shows 30pt for first paragraph, 22pt for second.
**Assessment**: This tests the UI binding between paragraph styles and the ribbon input. The paragraph style resolution is a pure function. A unit test could verify that `paragraphStyles[0].fontSize === 30` and `paragraphStyles[1].fontSize === 22` without a browser.
**Recommendation**: **Good candidate for unit test.** The style-to-panel binding is straightforward data flow.

#### 5. `repro-ribbon-wrap.spec.js` - ribbon section label verification
**Current**: Checks that ribbon sections have correct labels and no redundant internal labels.
**Assessment**: This is a DOM structure test. The section configuration (`getRibbonSections`) is already unit-tested in `test-spread-editor-app.js`. The Playwright test adds value by verifying the actual rendered custom element structure.
**Recommendation**: `test-spread-editor-app.js` already covers the logic. Playwright test is a visual regression guard.

#### 6. `gestures.spec.js` - "changing font family without selection should apply to whole paragraph"
**Current**: Enter text mode, click to position cursor, change font dropdown, verify attribute.
**Assessment**: The core logic (`applyCharacterStyleToCurrentParagraph`) is in `editor-state.js` and could be unit tested. The Playwright test verifies the command dispatch chain + dropdown UI.
**Recommendation**: **Good candidate for additional unit test** on `applyCharacterStyleToCurrentParagraph`.

#### 7. `selection-modes.spec.js` - "should have system text selection disabled"
**Current**: Checks `getComputedStyle(document.body).userSelect` is `none`.
**Assessment**: This is a pure CSS verification. It's trivial in Playwright but has no unit-test equivalent. The value is low but the cost is also low.
**Recommendation**: Keep as Playwright (CSS needs a browser).

### MEDIUM value candidates

#### 8. `trailing-space.spec.js` - cursor advances after space
**Current**: Types "A", measures cursor X, types space, measures cursor X again.
**Assessment**: This is fundamentally a layout engine + positions test. The cursor position depends on glyph advances from the WASM shaper, which cannot run in Node.js. However, the *logic* of trailing space handling in `positions.js` / `buildPositions` could be tested with synthetic glyph data.
**Recommendation**: **Good refactoring candidate.** Add a unit test to `test-positions.js` with a synthetic trailing-space glyph to verify the extra position entry. Keep Playwright as a regression test for the real shaper.

#### 9. `rocking-text.spec.js` - text stability
**Current**: Types text, measures element position, types more text, re-measures.
**Assessment**: This is a justification/layout stability test. The root cause would be in `justifier.js` or `positions.js`. A unit test with synthetic glyph data could verify that word positions remain stable when words are appended.
**Recommendation**: **Good refactoring candidate.** Similar to trailing-space: add a synthetic unit test in `test-justifier.js` or `test-positions.js`.

### Tests that MUST remain Playwright

#### 10. `focus-preservation.spec.js` - focus after button clicks
**Rationale**: Tests real browser focus behavior, shadow DOM interactions, and `document.activeElement` state. Cannot be meaningfully unit-tested.

#### 11. `clipboard.spec.js` - cut/paste with system clipboard
**Rationale**: Tests the full `navigator.clipboard` API, clipboard permissions, and browser event dispatch chain. The unit test `test-clipboard.js` covers the data layer; this tests the browser integration.

#### 12. `shapes-demo.spec.js` - shape interactions
**Rationale**: Tests visual selection, marquee drag, and DOM manipulation in the shapes demo. Tightly coupled to browser rendering.

#### 13. `spread-editor.spec.js` - loads without errors
**Rationale**: Smoke test that WASM + fonts + full pipeline initializes without console errors. Inherently requires a browser.

#### 14. `gestures.spec.js` - double-click, drag selection, text mode entry
**Rationale**: Tests pointer event sequences, SVG hit testing, and visual cursor/selection rendering. These require real browser event dispatch.

#### 15. `selection-modes.spec.js` - mode transitions, background clicks
**Rationale**: Tests the full interaction loop: pointer events -> mode state -> DOM attributes -> ribbon visibility. The mode-switching logic is already unit-tested, but the DOM attribute propagation and ribbon visibility require a browser.

---

## Recommended Refactoring Actions

### Priority 1: Extract testable logic from Playwright-only paths

1. **`applyCharacterStyleToCurrentParagraph`**: Add unit test in `test-editor-state.js`. Currently only tested via Playwright (`gestures.spec.js` font-family test).

2. **Trailing space position mapping**: Add a unit test to `test-positions.js` with a glyph sequence ending in a space character, verifying that `buildPositions` emits a final position entry beyond the space advance.

3. **Text stability (rocking text)**: Add a unit test to `test-justifier.js` or `test-positions.js` that verifies word X positions don't shift when a new word is appended to the same line.

4. **Paragraph style resolution for UI panel**: Add a unit test verifying that `paragraphStyles[n].fontSize` is correctly resolved for cursor positions in different paragraphs.

### Priority 2: Reduce Playwright test scope where unit coverage overlaps

5. **`story-editor.spec.js` undo tests**: These duplicate unit-tested logic. Consider marking as `@slow` or moving to a separate "rendering regression" suite that runs less frequently.

6. **`clipboard.spec.js` localStorage checks**: The localStorage clipboard verification (lines 79-83 of `story-editor.spec.js`) duplicates `test-clipboard.js`. The Playwright test should focus on system clipboard behavior only.

### Priority 3: Structural improvements

7. **`TextInteractionController`** (`text-interaction.js`): This 233-line class handles pointer events, click counting, drag modes, keyboard shortcuts, and beforeinput delegation. It has **zero unit tests**. The click-counting and drag-mode logic (lines 68-91) could be extracted into a testable state machine that doesn't depend on DOM events.

8. **`BoxInteractionController`** (`box-interactions.js`): The move/resize box logic delegates to pure `box-model.js` functions, but the pointer event handling and "click-through" logic (line 64-75) has no unit tests. The state machine could be extracted.

---

## Summary

| Category | Count | Action |
|----------|-------|--------|
| Playwright tests that are essentially redundant with unit tests | 3 | Consider removing or relegating to slow suite |
| Playwright tests with extractable logic for unit tests | 4 | Add unit tests, keep Playwright as regression |
| Playwright tests that genuinely need a browser | 7 | Keep as-is |
| Source modules with no unit tests at all | 2 | `text-interaction.js`, `box-interactions.js` |

The codebase already has a strong unit test foundation. The main gap is that some logic in interaction controllers (`TextInteractionController`, `BoxInteractionController`) is only tested through Playwright because it's tangled with DOM event handling. Extracting the state-machine logic from these controllers would provide the largest testability improvement.

---

## Completed Refactoring (2026-04-05)

### New unit tests added

1. **`test-editor-state.js`** — `applyCharacterStyleToCurrentParagraph` (2 tests):
   - Styles whole paragraph without moving cursor
   - Preserves existing mixed bold/italic styles

2. **`test-editor-state.js`** — paragraph style resolution for UI panel (3 tests):
   - `paragraphStyles` tracks per-paragraph `fontSize` via `cursor.paraIndex`
   - `paragraphStyles` grows when inserting paragraph breaks
   - `paragraphStyles` shrinks when merging paragraphs via delete

3. **`test-positions.js`** — trailing space position mapping (1 test):
   - `buildPositions` emits a position after trailing space so cursor can advance

4. **`test-justifier.js`** — text stability / rocking text (1 test):
   - Word positions remain stable when appending a new word to a left-aligned line

### Extracted modules and their tests

5. **`story-editor/lib/click-tracker.js`** — pure `ClickTracker` class extracted from `TextInteractionController`:
   - Multi-click detection (single, double, triple) with configurable threshold
   - `resolveAction()` returns drag mode and action type
   - **`test-click-tracker.js`** — 12 tests covering click counting, thresholds, reset, and action resolution

6. **`spread-editor/app/drag-state.js`** — pure `DragState` class extracted from `BoxInteractionController`:
   - Tracks pointer movement delta and moved/not-moved state
   - `resolve()` determines click-through vs drag on pointer-up
   - **`test-drag-state.js`** — 9 tests covering thresholds, stickiness, body vs handle, wasAlreadySelected

### Refactored source files

- `story-editor/lib/text-interaction.js` — now imports and uses `ClickTracker` instead of inline click counting
- `spread-editor/app/box-interactions.js` — now imports and uses `DragState` instead of inline state object

### Phase 2: Expand unit test coverage (2026-04-05)

7. **`spread-editor/test/test-box-model.js`** — 36 tests for all 6 exported functions in `box-model.js`:
   - `createBoxesFromDefaults` (5 tests): default IDs, explicit IDs, default/custom min dimensions, exact coordinate copy
   - `replaceBox` (3 tests): matching ID replacement, missing ID no-op, immutability
   - `clampBoxToBounds` (9 tests): within-bounds no-op, left/right/top/bottom clamping, min width/height enforcement, max width cap, non-zero bounds origin
   - `clampBoxesToBounds` (1 test): array-level clamping
   - `moveBox` (4 tests): delta application, bounds clamping, negative deltas, dimension preservation
   - `resizeBox` (14 tests): all 8 compass handles (e/s/w/n/se/nw/ne/sw), min width/height enforcement on east/south/west/north shrink, bounds clamping, custom minWidth

8. **`story-editor/test/test-story-ops.js`** — 15 new tests added:
   - `getStoryFragment` (7 tests): collapsed range, single-paragraph, mixed-style runs, two paragraphs, three paragraphs, style preservation, reversed positions
   - `insertStoryFragment` (8 tests): empty fragment, single-paragraph insert, style preservation, multi-paragraph split, three-paragraph insert, start/end insertion, round-trip with `getStoryFragment`

9. **`story-editor/test/test-editor-state.js`** — 12 new tests added:
   - `selectParagraphAt` (3 tests): selects entire paragraph, clamps out-of-bounds paraIndex, preserves lineIndex
   - `clearSelection` (2 tests): removes active selection, no-op when no selection
   - `getRichSelection` (3 tests): empty when no selection, returns fragment for range, works across paragraphs
   - `insertStory` (4 tests): single-paragraph insert, multi-paragraph insert with paragraphStyles update, replaces selection first, returns false for empty fragment

### Verification

- All 144 story-editor unit tests pass (was 117, +27 new)
- All 36 box-model unit tests pass (new)
- All 12 click-tracker unit tests pass
- All 9 drag-state unit tests pass
- All 11 app-shell unit tests pass
- All 26 Playwright tests pass
- Pre-existing failures in `test-spread-editor-app.js` (3 tests) are unchanged; they are due to stale mocks unrelated to this work.

### Remaining gaps

- `text-interaction.js` and `box-interactions.js` still have DOM-coupled logic not covered by unit tests (pointer event handling, keyboard shortcut dispatch). The extractable state-machine parts (`ClickTracker`, `DragState`) are now covered.
- `test-spread-editor-app.js` has 3 pre-existing test failures from stale mocks (missing `requestUpdate` and `getRibbonSections` changes). These are unrelated to this work but should be addressed separately.
