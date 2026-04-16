# Multi-Story Architecture for Spread Editor

**Status**: Completed

## Goal

Each text frame (or chain of linked text frames) should have its own independent story (`EditorState`). Previously the spread editor had a single `EditorState` that flowed text across all text boxes. New frames created via Create > Text Frame joined the end of the single text chain.

After this refactor, creating a new text frame produces an independent empty story. The existing 4 default boxes keep the original story from `#sample-text`.

## Design

### Data Model

Introduced a `StoryEntry` concept (plain object, not a class):

```js
{
  id: string,           // e.g. 'story-0', 'story-1'
  editor: EditorState,  // owns story, cursor, selection, paragraphStyles
  boxIds: string[],     // ordered list of box IDs assigned to this story
  lineMap: LineMapEntry[], // layout result for this story's boxes
}
```

`SpreadEditorApp` changes:
- `this._stories` — `StoryEntry[]` (replaces the single `this.editor`)
- `this.editor` — getter that returns `this._activeStory?.editor` (backwards compat)
- `this._activeStory` — reference to the currently active `StoryEntry`
- On init, one story is created from `#sample-text` with the 4 default box IDs.
- `_createTextFrame()` creates a new box AND a new `StoryEntry` with an empty story `[[{ text: '', style: { bold: false, italic: false } }]]`.

### Rendering Pipeline

In `update()`:

1. Compute spread layout, clamp boxes (unchanged).
2. For each story in `this._stories`:
   a. Gather that story's boxes (filter `this.boxes` by `story.boxIds`).
   b. First story: call `engine.renderToContainer()` to create the base SVG.
   c. Additional stories: call `engine.renderStory()` (new API), then transplant text elements from secondary SVG into the base SVG.
3. Each story stores its own `lineMap`.
4. Decorate, draw overlays, cursor (using active story's lineMap).

Added `LayoutEngine.renderStory()` — same as `renderToContainer` but returns `{ svg, lineMap }` without modifying any container. `renderToContainer` now delegates to `renderStory` internally.

### Text Mode Entry

When the user double-clicks a text box to enter text mode:

1. `_findStoryForBox(boxId)` — looks up which story owns the box.
2. `_activateStoryForBox(boxId)` — sets `_activeStory`, swaps editor/cursor on the interaction controller.
3. Enter text mode with the correct story active.

Added `setEditor(editor)` to `TextInteractionController`.

### Undo/Redo

`submitAction()` snapshots ALL stories' editor states, boxIds, and the story counter. On undo, all stories are reconstructed from the snapshot.

### Clipboard / Ribbon

These reference `this.editor` — the getter returns the active story's editor, so they work unchanged.

## Tasks

- [x] Write plan
- [x] Introduce `_stories` array and `_activeStory`
- [x] Refactor init to create initial story from sample text
- [x] Refactor `_createTextFrame()` to create new story
- [x] Add `setEditor()` to `TextInteractionController`
- [x] Add `renderStory()` to `LayoutEngine`
- [x] Refactor rendering to handle multiple stories
- [x] Refactor text mode entry to activate correct story
- [x] Refactor submitAction to snapshot/restore all stories
- [x] Add 3 new Playwright tests for multi-story behavior
- [x] Verify all 51 tests pass
