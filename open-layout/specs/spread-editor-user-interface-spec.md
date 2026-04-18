# Spread Editor User Interface Spec

Date: 2026-04-12 (initial), 2026-04-19 (completed)

This spec describes the expected desktop publishing interaction behavior
and current Spread Editor implementation status.

## 1. Object Selection & Mode Transitions

Users seamlessly transition between moving boxes on the canvas ("Object Mode")
and editing the contents of those boxes ("Text/Edit Mode").

### Expected Behavior
- **Clicking an Unselected Box:** Selects it (Object Mode).
- **Entering Text Mode:** Clicking a box that is *already selected* enters Text Mode and places the text cursor at the exact pointer coordinates.
- **Deselection:** Clicking empty canvas deselects the current box and exits Text Mode.
- **Drag to Move:** Clicking and dragging on a selected box moves it.
- **Drag to Select Text:** In Text Mode, clicking and dragging selects text ranges (blocking box drag).

### Implementation Status

Implemented: object selection, re-click to enter text mode, object drag in object mode, background click deselection, Escape key to exit text mode. Creating a new text frame immediately enters text mode with the cursor ready.

## 2. Text Selection Gestures

### Expected Behavior
- **Single Click:** Places the blinking text cursor at the exact coordinate.
- **Double Click:** Selects the word beneath the cursor, snapping to word boundaries.
- **Triple Click:** Selects the entire paragraph.
- **Shift + Click:** Extends selection from the original anchor to the clicked coordinate. Consecutive shift+clicks preserve the original anchor.
- **Shift + Drag:** Expands the current selection dynamically without dropping the original anchor.

### Implementation Status

Implemented: single, double, triple click selection, shift+click extension (forward, reverse, cross-line), click-drag selection (single-line and multi-line), and consecutive shift+click anchor preservation. Playwright tests in `text-selection-cursors.spec.js` cover all variants including anchor invariant assertions.

## 3. Visual Cursors & Mouse States

### Expected Behavior
- **Default (Arrow):** Empty canvas or un-selectable items.
- **Move:** Hovering over a selected box in Object Mode.
- **I-Beam (Text):** Hovering over text content in Text Mode.
- **Directional resize:** On the eight resize handles (`nwse-resize`, `nesw-resize`, `ns-resize`, `ew-resize`).
- **Pointer (Hand):** On output ports, overflow markers, and link-mode targets (`cursor: cell`).

### Implementation Status

Implemented. All cursor rules verified by Playwright tests in `text-selection-cursors.spec.js`.

## 4. Visual Selection Responses

### Expected Behavior
- **Object Selection:** Bounding box with control handles on corners/edges.
- **Text Selection Highlight:** Translucent color blocks overlaid on selected text lines.
- **Blinking Insertion Point:** Vertical line blinking when editing with no range selected.

### Implementation Status

Implemented: object selection boxes, text range highlighting, and blinking insertion cursor.

Open items:
- Clear visual distinction between primary selected object and secondary/hover states.
- Verification of selection highlight contrast/accessibility in all supported themes/backgrounds.

## Structural Notes

### Re-export boundary

`spread-editor/lib/story-editor-core.js` is the barrel re-export for all story-editor modules used by the spread editor. It exports: `LayoutEngine`, `extractParagraphs`, `TextCursor`, `EditorState`, `TextInteractionController`, `extractParagraphStyles`, `buildParagraphLayoutStyles`, `parseHtmlToStory`, `cloneStyle`, `DEFAULT_STYLE`, `styleEq`, `cloneParagraphStyle`, `DEFAULT_PARAGRAPH_STYLE`.

`document-store/` imports `cloneStyle` and `cloneParagraphStyle` directly from `story-editor/lib/` because routing through the spread-editor barrel would invert the dependency direction. A future shared `document-model/` module could resolve this.

### CSS architecture

Each demo page owns its `#svg-container` styles inline. Common properties (`user-select: none`, `caret-color: transparent`) are intentionally duplicated rather than extracted to a utility class, since the remaining properties differ substantially per page.
