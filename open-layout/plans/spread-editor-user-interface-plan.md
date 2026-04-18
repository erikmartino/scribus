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

Implemented: single, double, triple click selection and shift+click anchored extension.

Missing/incomplete:
- Robust shift+drag continuous extension behavior across line boundaries.
- Explicit acceptance tests for reverse-direction range extension and anchor preservation.

## 3. Visual Cursors & Mouse States

Proper contextual mouse cursors immediately hint to the user which actions are available before they ever click.

### Expected Behavior
- **Default (Arrow):** Hovering over the empty canvas or un-selectable items.
- **Move (Crosshair / Multi-direction arrows):** Hovering over a selected box in Object Mode to indicate draggable state.
- **I-Beam (Text Cursor):** Hovering over text content while in Text Mode, signaling that a click will drop a text insertion point.
- **Pointer (Hand):** Hovering over resize handles or interactive button ribbons.

### Current Implementation Status

Partial: base hover behavior exists, but cursor-mode fidelity is not fully deterministic in all states.

Missing/incomplete:
- Consistent move cursor over draggable selected object body in object mode.
- Deterministic I-beam over editable text regions only in text mode.
- Explicit resize-handle pointer affordances for all handles.

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

## Next Plan Items

- [ ] Add Playwright coverage for shift+drag range extension and anchor invariants.
- [ ] Tighten cursor-style state machine and assert styles in browser tests.
- [ ] Add visual state snapshots for object select/hover/edit transitions.
