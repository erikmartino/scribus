# Story Editing Evaluation

## Goal

Assess what it would take for the `docs/story-editor` prototype to move from **render-only** to a real **editable story model**.

## Current State

- The pipeline is cleanly separated: extract -> hyphenate -> shape -> break -> justify -> render.
- Cursor/navigation already exists (`cursor.js`, `story-position.js`, `positions.js`) and maps clicks/keys to story positions.
- Data model (`Story = Run[][]`) is normalized and already suitable for character-based addressing.
- Re-layout is deterministic and centralized in `LayoutEngine.renderToContainer()`.

## Adaptability Assessment

Overall: **good fit for editing (7.5/10)**.

Why it adapts well:
- Cursor logic is model-based (positions), not DOM-based.
- Rendering is pure from data; no hidden editor DOM state to reconcile.
- Modules are composable and testable, so editing can be added as a model layer without rewriting layout.

Main gaps:
- No mutation API for `Story` (insert/delete/split/merge runs/paragraphs).
- No transaction/update loop (every key needs model update + re-render + cursor remap).
- No selection model yet (single caret only).
- Style handling on edit boundaries is undefined (which style new text inherits).

## What Must Be Added

1. **Story operations layer**
   - Pure functions for `insertText`, `deleteBackward`, `deleteForward`, `insertParagraphBreak`, `mergeParagraphs`.
   - Run normalization after edits (merge adjacent identical styles, drop empty runs).

2. **Editor controller/state**
   - Single source of truth: `{ story, cursor, selection?, typingStyle? }`.
   - Key handling in one place; `cursor.js` should delegate editing actions instead of owning behavior.

3. **Render/update contract**
   - `applyEdit(operation) -> newState -> relayout -> cursor restore`.
   - Cursor restore by story position first, then line remap (already partially supported).

4. **Selection + clipboard (next stage)**
   - Anchor/focus selection model.
   - Replace selection on typing.
   - Copy/cut/paste as story fragments (not raw DOM).

## Architectural Risks

- Current full re-shape/re-layout on each keypress may become slow on large stories.
- `extractParagraphs()` is ingestion-only; editing should not depend on DOM as source of truth.
- IME/composition and grapheme-aware deletion are non-trivial and should be scoped explicitly.

## Abstract Plan

### Phase 1 — Editable Core (MVP)
- Introduce `lib/story-ops.js` with pure story mutation functions.
- Add `EditorState` wrapper around story + cursor.
- Wire `keydown` text input (`input`, `beforeinput`, backspace/delete/enter) to operations.
- Re-render after each operation and restore cursor.
- Add tests for story ops and cursor invariants.

### Phase 2 — Robust Text Editing
- Add selection model and range operations.
- Implement paste/cut/copy using story fragments.
- Define style inheritance rules for inserted text.
- Add word/line navigation shortcuts.

### Phase 3 — Performance + Fidelity
- Incremental re-layout (changed paragraph range only).
- Cache shaped paragraphs/runs.
- Better Unicode behavior (grapheme clusters, IME composition).

## Recommended First Milestone

Deliver a **single-caret plain text editor** on top of existing styled runs:
- typing, backspace/delete, enter, arrows,
- deterministic run normalization,
- no selection yet.

This milestone validates the architecture with minimal risk and creates a solid base for selection and styling.
