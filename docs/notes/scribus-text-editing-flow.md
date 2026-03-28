# Scribus Text Editing Flow

This note summarizes how a user edit travels through Scribus from input event to painted result.

## Flow Summary

1. **Event dispatch** - Qt sends mouse/keyboard events to the active canvas mode.
2. **Edit-mode handling** - `CanvasMode_Edit` interprets events as cursor, selection, or text edits.
3. **Model update** - `StoryText` cursor/selection/text is updated.
4. **Invalidation** - frame chain is marked dirty from the affected range onward.
5. **Lazy layout + render** - on paint, layout recomputes as needed, then text and overlays are drawn.

## Key Entry Points

- Mouse/keyboard mode handlers in `canvasmode_edit.cpp`.
- Cursor placement via `ScribusView::slotSetCurs()` and `textPositionFromPoint()`.
- Character insertion/deletion in `PageItem_TextFrame::handleModeEditKey()`.
- Layout invalidation via `StoryText::changed(...)` -> `slotInvalidateLayout(...)`.
- Lazy relayout in `PageItem_TextFrame::DrawObj_Item()` when `invalid` is set.

## Caret + Selection Mapping

- Caret visual position comes from layout position-to-point conversion (`TextLayout::positionToPoint`).
- Point-to-position hit testing walks box hierarchy and resolves cluster internals.
- Ligature clicks are split into subranges to recover character-level cursor positions.

## Important Behavior Traits

- Layout is deferred to paint (avoids repeated immediate relayout during bursts of edits).
- Linked frames share one story model, so invalidation propagates along the chain.
- Selection highlight rendering is handled in glyph box painting logic.

## Practical Takeaway

Scribus editing is model-first: input changes `StoryText`, layout derives from that model lazily, and rendering is a view over box data.
