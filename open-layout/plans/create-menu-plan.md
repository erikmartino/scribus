# Create Menu - Implementation Plan

**Status**: Completed (app-shell demo)

## Goal

Add a "Create" button to the leftmost position of the ribbon bar that opens a dropdown listing all registered creatable object types. Plugins register their creatables via a shell API, and selecting an item creates a new object on the workspace.

## Design

### Registry API (`AppShell`)

- `shell.creatables` - array of registered creatable descriptors.
- `shell.registerCreatable({ id, label, icon?, onCreate })` - adds a creatable type to the registry and triggers a ribbon update.
- `creatables-changed` event - fired on the shell when a creatable is registered.

### Component (`<scribus-create-menu>`)

- Location: `app-shell/lib/components/create-menu.js`
- A shadow-DOM web component with a `+` trigger button and an absolutely-positioned dropdown.
- Reads `window.scribusShell.creatables` to populate items.
- Closes on outside click or after item selection.

### Ribbon Integration (`SystemPlugin`)

- The Create section is prepended as the first ribbon section (before Application).
- Only rendered when `shell.creatables.length > 0`.

### Demo Integration (`ShapesDemoPlugin`)

- Registers Circle, Square, Triangle as creatables in `init()`.
- Each calls `_createNewShape(type)` which goes through the history system (undo/redo supported).

## Completed Tasks

- [x] `registerCreatable` API on `AppShell`
- [x] `<scribus-create-menu>` web component
- [x] `SystemPlugin` renders Create section as first ribbon section
- [x] `ShapesDemoPlugin` registers 3 shape creatables
- [x] Playwright tests (7 tests, all passing)

## Remaining Work

- Integrate creatables into other demos (spread-editor, story-editor) when those demos have creatable types.
