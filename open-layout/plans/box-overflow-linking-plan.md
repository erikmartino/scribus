# Text Frame Overflow & Linking Indicators

**Status**: Completed (Phase 1 + Phase 2)

## Goal

Show visual indicators on text frames to communicate chain/linking state and overflow.

## Phase 1: Visual Indicators (Completed)

Each text box shows two port indicators:

- **Input port** (top-left triangle): outline-only if the box starts a new story, filled if it receives text from a predecessor in a chain.
- **Output port** (bottom-right triangle): filled if text continues to a linked successor box, outline-only if it is the last in a chain with no overflow.
- **Overflow marker** (red `+` square): replaces the output port on the last box when the story's text exceeds the available frame capacity.

Image boxes have no ports.

### Implementation

- `LayoutEngine.flowIntoBoxes()` now returns `{ boxResults, overflow }` instead of just `boxResults`. The `overflow` flag is `true` when glyphs remain after all boxes are exhausted.
- `LayoutEngine.renderStory()` and `renderToContainer()` propagate the `overflow` flag in their return values.
- `SpreadEditorApp.update()` captures `overflow` per story entry and passes `stories` (array of `{ boxIds, overflow }`) to `drawBoxOverlay()`.
- `drawBoxOverlay()` renders a `[data-sublayer="ports"]` group with `[data-port="input"]`, `[data-port="output"]`, and `[data-overflow="true"]` SVG elements.

### Tests

7 Playwright tests in `spread-editor/test/box-ports.spec.js`:
- Default text boxes have input and output port indicators
- First box in a chain has an unfilled input port
- Middle boxes in a chain have filled input ports
- Boxes with continuation have filled output ports
- New text frame has unfilled input and output ports
- Image boxes do not have ports
- Overflow marker appears when text exceeds frame capacity

## Phase 2: Linking Interaction (Completed)

### Features

- **Output port click on last box** → enters link mode (`mode = 'link'`, `data-mode="link"` on shell).
- **Link mode visual feedback** → valid target boxes (text frames belonging to other stories) are highlighted with a dashed blue overlay (`[data-link-target="true"]`).
- **Clicking a target box** → appends the target story's boxes and text content to the source story's chain, then exits link mode.
- **Escape key** → cancels link mode without linking.
- **Clicking a filled output port** (mid-chain) → unlinks the chain at that point, creating a new independent story from the downstream boxes.
- **Undo/redo** → both link and unlink operations are fully undoable via `submitAction`.

### Implementation

- `SpreadEditorApp._handleOutputPortClick(boxId)` — dispatches to `_enterLinkMode` or `_unlinkAt` depending on chain position.
- `SpreadEditorApp._enterLinkMode(sourceBoxId)` — sets `_linkSource` and `mode = 'link'`.
- `SpreadEditorApp._exitLinkMode()` — clears link state, returns to object mode.
- `SpreadEditorApp._linkBoxes(targetBoxId)` — merges target story into source story, removes target story entry.
- `SpreadEditorApp._unlinkAt(boxId)` — splits chain, creates new story with empty content for downstream boxes.
- `box-overlay.js: _drawLinkModeOverlay()` — renders `[data-sublayer="link-mode"]` with `[data-link-target]` highlight rects.
- Port click detection in `bindEvents` — checks `data-port`, `data-port-box`, `data-overflow` attributes before box interaction handling.

### Tests

7 Playwright tests in `spread-editor/test/box-linking.spec.js`:
- Clicking output port on last box of a chain enters link mode
- Link mode shows target highlights on other story boxes
- Escape cancels link mode
- Linking a new text frame appends it to the chain
- Linking is undoable
- Clicking filled output port unlinks the chain
- Unlinking is undoable
