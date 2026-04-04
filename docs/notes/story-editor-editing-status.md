# Story Editor Editing Status

## Current State

`docs/story-editor` includes a fully implemented editing model shared with the Spread Editor.

- [x] **Core Model**: Pure story mutation + central editor state.
- [x] **Editing Loop**: `beforeinput` + `keydown` fallback for precise typing control.
- [x] **Selection**: Mouse drag-to-select, double-click for words, and triple-click for paragraphs.
- [x] **Navigation**: Grapheme-boundary-aware cursor tied to line-map positions.
- [x] **Shared UI**: Centralized `Typography` and `Formatting` ribbon sections used by both Story and Spread editors.
- [x] **App Shell Integration**: 
    - [x] Integrated undo/redo transactions via `CommandHistory`.
    - [x] Rich clipboard service (Story item format) with localStorage fallback.
    - [x] Native keyboard shortcuts (Select All, Bold/Italic).
    - [x] Cut/copy/paste verified with Playwright (both system clipboard and localStorage paths).
- [x] **Cross-Demo Sharing**: `spread-editor` now consumes `story-editor/lib` via `story-editor-core.js`.
- [x] **Character Styling**: Bold, italic, and font family applied per-run within paragraphs.
- [x] **Paragraph Styling**: Font size applied per-paragraph via `paragraphStyles`.

## Remaining Gaps

1. **Performance**
   - Full-document relayout/rerender still happens per edit.
   - Paragraph shaping cache is implemented in `layout-engine`, but line breaking and justification are still global per paragraph group.

2. **Text Correctness**
   - **Grapheme Clusters**: Basic movement is safe, but explicit cluster-aware deletion (e.g., complex emojis/accents) needs more validation.
   - **IME/Composition**: Composition events are not deeply tested; composition text should be bypassed or handled natively during the typing session.
   - **Complex Scripts**: BiDi and script-specific justification rules are currently out of scope.

3. **Editing Features**
   - [ ] **Tab Handling**: Native tab key behavior (indentation vs focus).
   - [ ] **Shift+Click Range Selection**: Extend selection by holding Shift during click.

## Recommended Next Milestone

Focus on production-oriented reliability:
- [ ] Incremental line layout/render on top of existing shaping cache.
- [ ] Grapheme-aware cursor/delete semantics for all edge cases.
- [ ] IME test coverage (using Playwright to simulate composition).
