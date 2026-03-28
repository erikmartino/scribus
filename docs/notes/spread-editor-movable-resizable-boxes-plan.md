# Spread Editor Movable/Resizable Boxes Plan

## Scope

Implement movable and resizable text boxes in `docs/spread-editor` with standard UI handles, while preserving standalone component pages and combined app behavior.

## Layout Rules

- The spread has two touching pages (no gap between left and right pages).
- A pasteboard surrounds the spread and acts as the working area.
- Boxes are clamped to pasteboard bounds by default.

## Remaining Work

1. Geometry model updates
   - Update `spread-geometry` to return:
     - `pageRects` (left/right contiguous pages),
     - `spreadRect` (combined page area),
     - `pasteboardRect` (outer canvas),
     - default initial boxes.
   - Remove gap-based page positioning from spread layout.

2. Box state model
   - Add `box-model` module for editable box state (`id`, `x`, `y`, `width`, `height`, min-size, z-order).
   - Keep model separate from rendering and pointer logic.

3. Interaction controller
   - Add pointer-driven drag/resize controller with state machine:
     - `idle`, `dragging-box`, `resizing-box`.
   - Support pointer capture and robust cancel/up handling.

4. Resize handles and visuals
   - Add 8 handles per selected box:
     - corners: `nw`, `ne`, `se`, `sw`
     - edge midpoints: `n`, `e`, `s`, `w`
   - Use standard cursors (`nwse`, `nesw`, `ns`, `ew`, `move`).
   - Add selected border decoration and usable hit targets.

5. Constraint behavior
   - Enforce `minWidth`/`minHeight`.
   - Clamp resulting box rectangle to pasteboard bounds:
     - `x >= pasteboard.x`
     - `y >= pasteboard.y`
     - `x + width <= pasteboard.x + pasteboard.width`
     - `y + height <= pasteboard.y + pasteboard.height`

6. App integration
   - Replace fixed boxes in `spread-editor-app` with `box-model` state.
   - Reflow text through current box list on every interaction update.
   - Ensure normal text editing still works when not dragging/resizing.

7. Component parity
   - Apply same movable/resizable behavior to:
     - combined app (`spread-editor/index.html`),
     - standalone spread-layout component (`components/spread-layout/index.html`).
   - Keep story-core component independent and runnable.

8. Verification checklist
   - Drag box body moves box.
   - All 8 handles resize correctly.
   - Boxes cannot leave pasteboard.
   - Min size constraints work.
   - Text reflows live while box geometry changes.
   - Combined app and standalone component routes still load.

## Suggested File Additions

- `docs/spread-editor/app/box-model.js`
- `docs/spread-editor/app/box-interactions.js`
- `docs/spread-editor/app/box-overlay.js`

## Suggested Files to Update

- `docs/spread-editor/app/spread-geometry.js`
- `docs/spread-editor/app/spread-editor-app.js`
- `docs/spread-editor/components/spread-layout/main.js`
- `docs/spread-editor/index.html` (if needed for visual affordances)
