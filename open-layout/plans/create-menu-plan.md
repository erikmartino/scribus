# Create Menu - Implementation Plan

**Status**: Completed (app-shell demo, spread-editor)

## Goal

Add a "Create" button to the leftmost position of the ribbon bar that opens a dropdown listing all registered creatable object types. Plugins register their creatables via a shell API, and selecting an item creates a new object on the workspace.

## Design

### Registry API (`AppShell`)

- `shell.creatables` - array of registered creatable descriptors.
- `shell.registerCreatable({ id, label, icon?, onCreate })` - adds a creatable type to the registry and triggers a ribbon update.
- `creatables-changed` event - fired on the shell when a creatable is registered.

### Component (`<scribus-create-menu>`)

- Location: `app-shell/lib/components/create-menu.js`
- A shadow-DOM web component with a `+` trigger button. The dropdown panel is portalled to `document.body` to escape the ribbon's overflow clipping context.
- Reads `window.scribusShell.creatables` to populate items.
- Closes on outside click or after item selection.

### Ribbon Integration (`SystemPlugin`)

- The Create section is prepended as the first ribbon section (before Application).
- Only rendered when `shell.creatables.length > 0`.

### Demo Integration (`ShapesDemoPlugin`)

- Registers Circle, Square, Triangle as creatables in `init()`.
- Each calls `_createNewShape(type)` which goes through the history system (undo/redo supported).

### Spread Editor Integration (`SpreadEditorApp`)

- Registers Text Frame and Image Frame as creatables in `_registerCreatables()`.
- Text Frame: creates a new text box that participates in the text reflow layout.
- Image Frame: creates a placeholder image box with an SVG cross-hatch placeholder.
- Both go through the history system (undo/redo supported, including `boxes` state).
- Fixed `submitAction()` to also snapshot/restore `this.boxes` for proper undo of text frame creation.
- Fixed `update()` box-reset logic to not clobber user-created text frames.

## Completed Tasks

- [x] `registerCreatable` API on `AppShell`
- [x] `<scribus-create-menu>` web component (portalled dropdown)
- [x] `SystemPlugin` renders Create section as first ribbon section
- [x] `ShapesDemoPlugin` registers 3 shape creatables
- [x] `SpreadEditorApp` registers Text Frame and Image Frame creatables
- [x] Playwright tests: app-shell (7), spread-editor (6), all passing

## Remaining Work

- Integrate creatables into story-editor when it has creatable types.
