# Text Frame Overflow & Linking Indicators

**Status**: Phase 1 Completed (visual indicators)

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

## Phase 2: Linking Interaction (Not Started)

Future work:
- Clicking an empty output port enters "link cursor" mode
- Clicking another text frame links the two into a chain (merging stories)
- Clicking a filled output port unlinks the next frame (splitting stories)
- Visual feedback during link mode (cursor change, hover highlight)
