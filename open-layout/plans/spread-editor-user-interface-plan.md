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

Implemented: single, double, triple click selection, shift+click extension (forward, reverse, cross-line), click-drag selection (single-line and multi-line), and consecutive shift+click anchor preservation. Playwright tests in `text-selection-cursors.spec.js` cover all variants including anchor invariant assertions.

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
- [x] Consecutive shift+click anchor invariant verified and tested.
- [x] `cloneStyle`/`cloneParagraphStyle` added to `story-editor-core.js` re-export boundary.

## Known Bugs

(none)

## Next Plan Items

(none — all interaction behavior items are implemented and tested)

## Structural Consolidation Opportunities

Cross-module imports currently reach deep into `story-editor/lib/` from both `spread-editor/` and `document-store/`. The following opportunities were evaluated:

### 1. Extract `style.js` and `paragraph-style.js` into a shared module

**Status:** Deferred. Moving these to a shared location would be the cleanest fix but is a larger refactor (~12 import sites across 8 files). Not needed until more modules depend on these utilities.

### 2. Add `style.js` and `paragraph-style.js` to the `story-editor-core.js` re-export ✅

**Status:** Done (2026-04-18). Added `cloneStyle`, `DEFAULT_STYLE`, `styleEq`, `cloneParagraphStyle`, and `DEFAULT_PARAGRAPH_STYLE` to the barrel export. Updated `spread-editor-app.js` to import through the barrel instead of deep `../../story-editor/lib/` paths. `document-store/` still uses direct imports (fixing it would require `document-store` to depend on `spread-editor`, which inverts the dependency direction).

### 3. Deduplicate `#svg-container` CSS

**Status:** Evaluated and declined (2026-04-18). Only 2 properties are actually shared (`user-select: none`, `caret-color: transparent`). Each file has substantially different `background`, `padding`, `border`, `cursor`, `min-height`, and `box-shadow` values. Extracting 2 lines into a utility class would add coupling without meaningful simplification.

### 4. Centralize the test DOM mock

**Status:** Keep as-is. Only 2 consumers, paths are clear. Revisit if consumer count grows.
