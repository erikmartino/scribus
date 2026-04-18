# Spread Editor User Interface Plan

Date: 2026-04-12

Status: Active planning reference.

This plan tracks expected desktop publishing interaction behavior and current Spread Editor parity.

## 1. Object Selection & Mode Transitions

In a DTP application, users seamlessly transition between moving boxes on the canvas ("Object Mode") and editing the contents of those boxes ("Text/Edit Mode"). The interaction flow should be frictionless and predictable.

### Expected Behavior
- **Clicking an Unselected Box:** A single click on an unselected box selects it (Object Mode). 
- **Entering Text Mode:** Clicking a box that is *already selected* instantly enters Text Mode and places the text cursor at the exact pointer coordinates.
- **Deselection:** Clicking anywhere on the empty spread/canvas deselects the current box and exits Text Mode, returning the application entirely to a neutral Object Mode.
- **Drag to Move:** Clicking and dragging on a selected box (or its unselected body) should move the physical box layout. 
- **Drag to Select Text:** If the application is already in Text Mode, clicking and dragging over the text should *select text ranges*, blocking the ability to drag the box itself (preventing conflicting gestures).

### Current Implementation Status

Implemented: object selection, re-click to enter text mode, object drag in object mode, background click deselection, and Escape key to exit text mode back to object mode. Creating a new text frame immediately enters text mode with the cursor ready.

## 2. Text Selection Gestures

When operating natively inside text mode, a robust set of mouse gestures is mandatory for rapid editing.

### Expected Behavior
- **Single Click:** Places the blinking text cursor at the exact coordinate. 
- **Double Click:** Selects the specific word directly beneath the cursor. The selection anchor automatically snaps to word boundaries.
- **Triple Click:** Selects the entire paragraph the cursor is enclosed within.
- **Shift + Click:** Range selection. If a cursor is already placed, holding `Shift` while clicking elsewhere will select all text continuously between the initial anchor and the clicked coordinate. 
- **Shift + Drag:** Holding `Shift` while dragging expands the current highlighted selection dynamically without dropping the original anchor point.

### Current Implementation Status

Implemented: single, double, triple click selection, shift+click extension (forward, reverse, cross-line), and click-drag selection (single-line and multi-line). Playwright tests in `text-selection-cursors.spec.js` cover all variants.

Known gap:
- **Anchor invariant on consecutive shift+clicks**: a second shift+click does not preserve the original selection anchor — it extends from the end of the prior selection rather than from the original caret position. This is a behavior bug in the editor, not a test issue.

## 3. Visual Cursors & Mouse States

Proper contextual mouse cursors immediately hint to the user which actions are available before they ever click.

### Expected Behavior
- **Default (Arrow):** Hovering over the empty canvas or un-selectable items.
- **Move (Crosshair / Multi-direction arrows):** Hovering over a selected box in Object Mode to indicate draggable state.
- **I-Beam (Text Cursor):** Hovering over text content while in Text Mode, signaling that a click will drop a text insertion point.
- **Pointer (Hand):** Hovering over resize handles or interactive button ribbons.

### Current Implementation Status

Implemented: CSS cursor rules cover the main states — `cursor: default` on the canvas, `cursor: move` on box bodies in object mode, `cursor: text` on the SVG container in text mode, and directional resize cursors (`nwse-resize`, `nesw-resize`, `ns-resize`, `ew-resize`) on the eight resize handles. Output ports and overflow markers use `cursor: pointer`. Link-mode targets use `cursor: cell`.

All cursor rules are verified by Playwright tests in `text-selection-cursors.spec.js`.

## 4. Visual Selection Responses

Users depend on immediate, non-intrusive visual feedback to comprehend what is actively selected and deeply edited.

### Expected Behavior
- **Object Selection:** Drawing a distinct bounding box (often with control handles on corners/edges) around the selected item.
- **Text Selection Highlight:** Continuous, solid translucent color blocks (often standard OS Blue `rgba(0, 120, 215, 0.3)`) overlaid precisely behind or perfectly aligned over the selected text lines. Multiple lines require multiple unified rectangles.
- **Blinking Insertion Point:** A sharp, easily readable vertical line blinking steadily when text is actively being edited but no range is currently selected.

### Current Implementation Status

Implemented: object selection boxes, text range highlighting, and blinking insertion cursor.

Missing/incomplete:
- Clear visual distinction between primary selected object and secondary/hover states.
- Verification of selection highlight contrast/accessibility in all supported themes/backgrounds.

## Completed since initial plan

- [x] Frame creation, deletion, linking/unlinking with full undo support.
- [x] Text frame overflow indicators and port visuals.
- [x] Create menu (Text Frame, Image Frame) with creatable registry.
- [x] New text frames enter text mode immediately with cursor ready.
- [x] Escape key exits text mode back to object mode.
- [x] Clicking empty linked frame places cursor at end of story.
- [x] Save/load documents to/from the store (Ctrl+S, `?doc=` URL param).
- [x] Document browser with template cloning and Open routing.
- [x] Shared UI components (`<scribus-status-bar>`, `<scribus-dialog>`).
- [x] Playwright coverage for shift+click, shift+drag, and click-drag selection.
- [x] Cursor-style assertions for all modes (object, text, resize, ports).
- [x] Visual state transition tests (select/deselect, enter/exit text mode, ribbon visibility).

## Known Bugs

- [ ] Consecutive shift+clicks do not preserve the original selection anchor (the anchor moves to the end of the previous selection instead of staying at the initial caret position).

## Next Plan Items

- [ ] Fix shift+click anchor invariant (consecutive shift+clicks should extend from original caret, not from end of previous selection).

## Structural Consolidation Opportunities

Cross-module imports currently reach deep into `story-editor/lib/` from both `spread-editor/` and `document-store/`. The following opportunities would simplify the dependency graph:

### 1. Extract `style.js` and `paragraph-style.js` into a shared module

**Problem:** `cloneStyle()` and `cloneParagraphStyle()` are imported by three modules — `story-editor/lib/`, `spread-editor/app/`, and `document-store/lib/` — each reaching into `story-editor/lib/` with deep `../../` paths.

**Proposal:** Move `style.js` and `paragraph-style.js` to a shared location (e.g., a new `document-model/` module or into `app-shell/lib/`). This would make the dependency direction explicit: shared data-model utilities live in one place, and all modules import from there.

**Files affected:** ~12 import sites across 8 files.

### 2. Add `style.js` and `paragraph-style.js` to the `story-editor-core.js` re-export

**Problem:** `spread-editor/lib/story-editor-core.js` already re-exports 7 modules from `story-editor/lib/`, but `spread-editor-app.js` still imports `cloneStyle` and `cloneParagraphStyle` directly from `story-editor/lib/` bypassing the re-export boundary.

**Proposal (minimal fix):** Add `cloneStyle` and `cloneParagraphStyle` to the `story-editor-core.js` barrel export. This keeps the existing architecture but closes the gap in the boundary. Does not help `document-store/` which also imports them directly.

**Files affected:** 3 (story-editor-core.js, spread-editor-app.js, document-store.js).

### 3. Deduplicate `#svg-container` CSS

**Problem:** `#svg-container` styles appear in four HTML files: `story-editor/index.html`, `spread-editor/index.html`, `spread-editor/components/spread-layout/index.html`, and `spread-editor/components/story-core/index.html`. Common properties (`user-select: none`, `caret-color: transparent`, `outline: none`) are repeated.

**Proposal:** Extract common `#svg-container` base styles into `shell.css` as a `.svg-workspace` utility class. Page-specific overrides (background color, cursor mode rules) stay inline.

**Files affected:** 4 HTML files.

### 4. Centralize the test DOM mock

**Problem:** `app-shell/test/dom-mock.js` is imported by unit tests in two other modules (`spread-editor/test/`, `story-editor/test/`). It's logically shared test infrastructure but lives inside `app-shell/test/`.

**Proposal:** Keep as-is (it's only 2 consumers and the path is clear), or move to a top-level `test-utils/dom-mock.js` if the consumer count grows.

**Files affected:** 2 (low priority).
