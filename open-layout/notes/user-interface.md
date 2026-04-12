# DTP Interaction Model & User Interface Guidelines

This document outlines the standard, expected interactions for desktop publishing (DTP) software (like Scribus, InDesign, or Figma) and evaluates how our current Spread Editor prototype compares to these established patterns.

## 1. Object Selection & Mode Transitions

In a DTP application, users seamlessly transition between moving boxes on the canvas ("Object Mode") and editing the contents of those boxes ("Text/Edit Mode"). The interaction flow should be frictionless and predictable.

### Expected Behavior
- **Clicking an Unselected Box:** A single click on an unselected box selects it (Object Mode). 
- **Entering Text Mode:** Clicking a box that is *already selected* instantly enters Text Mode and places the text cursor at the exact pointer coordinates.
- **Deselection:** Clicking anywhere on the empty spread/canvas deselects the current box and exits Text Mode, returning the application entirely to a neutral Object Mode.
- **Drag to Move:** Clicking and dragging on a selected box (or its unselected body) should move the physical box layout. 
- **Drag to Select Text:** If the application is already in Text Mode, clicking and dragging over the text should *select text ranges*, blocking the ability to drag the box itself (preventing conflicting gestures).

### Current Implementation Status
✅ Our Spread Editor now perfectly mirrors this flow. A single click selects the box. A subsequent single click enters text mode inline. Box dragging is explicitly disabled while in Text Mode to prioritize text selection, and clicking the background successfully clears all states.

## 2. Text Selection Gestures

When operating natively inside text mode, a robust set of mouse gestures is mandatory for rapid editing.

### Expected Behavior
- **Single Click:** Places the blinking text cursor at the exact coordinate. 
- **Double Click:** Selects the specific word directly beneath the cursor. The selection anchor automatically snaps to word boundaries.
- **Triple Click:** Selects the entire paragraph the cursor is enclosed within.
- **Shift + Click:** Range selection. If a cursor is already placed, holding `Shift` while clicking elsewhere will select all text continuously between the initial anchor and the clicked coordinate. 
- **Shift + Drag:** Holding `Shift` while dragging expands the current highlighted selection dynamically without dropping the original anchor point.

### Current Implementation Status
✅ We handle single, double, and triple clicks accurately via manual interval tracking in `TextInteractionController` (circumventing W3C `PointerEvent.detail` discrepancies). 
✅ `Shift + Click` ranges are supported by evaluating `e.shiftKey` and branching into `editor.moveCursor(pos, true)`. 
❌ **Missing/Incomplete:** We currently do not have robust gesture support for `Shift + Drag` continuous selection adjustments.

## 3. Visual Cursors & Mouse States

Proper contextual mouse cursors immediately hint to the user which actions are available before they ever click.

### Expected Behavior
- **Default (Arrow):** Hovering over the empty canvas or un-selectable items.
- **Move (Crosshair / Multi-direction arrows):** Hovering over a selected box in Object Mode to indicate draggable state.
- **I-Beam (Text Cursor):** Hovering over text content while in Text Mode, signaling that a click will drop a text insertion point.
- **Pointer (Hand):** Hovering over resize handles or interactive button ribbons.

### Current Implementation Status
⚠️ **Partial.** The application currently uses standard CSS hover states across some elements, but the dynamic switching of the mouse cursor from "Default" to "I-Beam" precisely over the text paths based on current application mode is not completely rigorous.

## 4. Visual Selection Responses

Users depend on immediate, non-intrusive visual feedback to comprehend what is actively selected and deeply edited.

### Expected Behavior
- **Object Selection:** Drawing a distinct bounding box (often with control handles on corners/edges) around the selected item.
- **Text Selection Highlight:** Continuous, solid translucent color blocks (often standard OS Blue `rgba(0, 120, 215, 0.3)`) overlaid precisely behind or perfectly aligned over the selected text lines. Multiple lines require multiple unified rectangles.
- **Blinking Insertion Point:** A sharp, easily readable vertical line blinking steadily when text is actively being edited but no range is currently selected.

### Current Implementation Status
✅ **Object Selection:** Bounding box stroke styles are correctly toggled on select.
✅ **Text Selection Highlight:** We calculate and render `.text-selection rect` blocks across multiple lines seamlessly using the layout engine.
✅ **Blinking Cursor:** The `TextCursor` class faithfully draws and blinks standard SVG lines synchronized to the DOM state.
