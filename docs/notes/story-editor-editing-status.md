# Story Editor Editing Status

## Current State

`docs/story-editor` now includes an implemented editing model (not just render-only).

In place:
- pure story mutation operations,
- central editor state,
- beforeinput + keydown fallback editing loop,
- selection + rich clipboard service,
- cursor/navigation tied to line-map positions,
- integrated undo/redo transaction history via App Shell,
- unit tests for story ops, editor state, cursor/positions, and layout integration.

## Remaining Gaps

1. **Performance**
   - Full-document relayout/rerender still happens per edit.
   - Paragraph shaping cache is now implemented in `layout-engine`, but line breaking/justification/rendering are still global.

2. **Text correctness depth**
   - No explicit grapheme-cluster-aware movement/deletion.
   - IME/composition behavior not deeply validated.
   - BiDi/complex-script editing behavior not fully addressed.

3. **Editing features**
   - [x] Rich clipboard support inside the App Shell.
   - [x] Undo/redo transaction history.
   - [x] Trailing space cursor movement.
   - [/] Typing style model is minimal.

## Recommended Next Milestone

Focus on production-oriented reliability:
- incremental line layout/render on top of existing shaping cache,
- [x] integrated undo/redo history,
- [ ] grapheme-aware cursor/delete semantics,
- [ ] IME test coverage and handling notes.
