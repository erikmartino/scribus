# Story Editor Editing Status

## Current State

`docs/story-editor` now includes an implemented editing model (not just render-only).

In place:
- pure story mutation operations,
- central editor state,
- beforeinput + keydown fallback editing loop,
- selection + plain-text clipboard path,
- cursor/navigation tied to line-map positions,
- unit tests for story ops, editor state, cursor/positions, and layout integration.

## Remaining Gaps

1. **Performance**
   - Full-document relayout/rerender per edit.
   - No incremental paragraph layout cache yet.

2. **Text correctness depth**
   - No explicit grapheme-cluster-aware movement/deletion.
   - IME/composition behavior not deeply validated.
   - BiDi/complex-script editing behavior not fully addressed.

3. **Editing features**
   - Clipboard currently plain-text only.
   - Undo/redo transaction model not implemented.
   - Typing style model is minimal.

## Recommended Next Milestone

Focus on production-oriented reliability:
- incremental layout + shaping cache,
- undo/redo transaction history,
- grapheme-aware cursor/delete semantics,
- IME test coverage and handling notes.
