# Image Drag-and-Drop Plan

Date: 2026-04-19

Status: **Complete** -- all implementation done, 262 unit tests and 137 E2E tests passing.

## Goal

Allow users to drag image files from the desktop (or file manager) onto the
spread editor canvas and have them placed as image boxes at the drop location.

## Implementation

### Event handlers (`_initDragDrop()` in spread-editor-app.js)

- `dragover` — prevents default (required to allow drop), sets `dropEffect: 'copy'`
- `dragenter` — shows drop zone highlight via overlay SVG (uses `dragCounter`
  to handle nested enter/leave from child elements)
- `dragleave` — hides highlight when `dragCounter` reaches 0
- `drop` — reads image files from `DataTransfer`, converts to data URLs,
  creates image boxes at the drop point (object mode) or inserts inline
  images at cursor (text mode)

### Coordinate conversion

Drop `clientX`/`clientY` → content-space via `getScreenCTM().inverse()` on
the content SVG. Image box centered on the drop point.

### Visual feedback

Semi-transparent blue overlay rectangle with dashed border, drawn in the
overlay SVG with `data-drop-highlight="true"`. Removed on drop or dragleave.

### Sizing

Proportional scaling capped at 300pt wide (matching paste behavior).

### Undo

Each dropped image is wrapped in `submitAction('Drop Image', ...)` for
full undo/redo support.

## Files changed

- `spread-editor/app/spread-editor-app.js` — `_initDragDrop()`,
  `_placeImageBoxAt()`, `_showDropHighlight()`, `_hideDropHighlight()`
- `spread-editor/test/image-drag-drop.spec.js` — 8 E2E tests

## E2E tests (8)

1. Dropping an image file creates an image box in object mode
2. Dropped image box is placed near the drop coordinates
3. Dropping an image in object mode is undoable
4. Dropping multiple image files creates multiple image boxes
5. Non-image files are ignored during drop
6. Drop highlight appears during dragenter and disappears on drop
7. Drop highlight disappears on dragleave
8. Image box from drop has resize handles
