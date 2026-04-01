# Architectural Evolution: Scribus App Shell (Next Phase)

This document outlines the design for the next major evolution of the Scribus App Shell, focusing on high-level services like clipboard, multi-selection, and undo/redo while **strictly maintaining isolated consumer demos**.

## 1. Core Principles (Guiding Strategy)
- **Strict Consumer Isolation**: The App Shell must remain a generic host. It should have zero knowledge of specific features like "text shaping" or "vector math". Any demo (Story Editor, Shapes, etc.) must remain an independent entry point.
- **Protocol-Based Commonality**: The shell provides the *infrastructure* (Copy/Paste, Selection, History) while the *consumers* (plugins/demos) provide the *data* and *implementation*.
- **No Monolith**: Each demo continues to live in its own directory with its own logic. The App Shell is the "Stage" they perform on.

---

## 2. The Abstract Document Model (ADM)

To support universal undo/redo and clipboard services without breaking isolation, the Shell introduces an **Abstract Document Model (ADM)**. This is a *protocol*, not a shared class.

### How it Works
1.  **The Shell holds a "Registry"**: A list of `AbstractItem` objects provided by the consumer demo.
2.  **No Type Knowledge**: The Shell knows an item has an `id` and can be `serialized`, but it doesn't know if it's a "Circle" or a "Paragraph".
3.  **Plugin Responsibility**: The demo (e.g., Story Editor) is responsible for interpreting the ADM items it cares about.

### Benefits
-   **Universal Serialization**: The Shell can "Copy" any item by calling its `serialize()` method, regardless of what that item is.
-   **Generic Persistence**: Consumers can use the Shell's save/load logic consistently across all isolated demos.
-   **Isolation**: The "Shapes Demo" code and "Story Editor" code never touch.

---

## 3. Universal Selection & Multi-Selection

The `SelectionService` must handle multiple items without knowing their properties.

- **`SelectionService.current`**: The primary selected item (the one shown in the Property Inspector).
- **`SelectionService.all`**: An array of `AbstractItem` references.
- **Multi-Selection Logic**: The shell handles the "Selection Marquee" (the UI rectangle) and logic (Shift+Click), but the *selection results* are just a list of IDs for the consumer to deal with.

---

## 4. Generic Undo / Redo Handling

Undo/Redo is implemented via a **Command Pattern** that the Shell facilitates.

- **Shell Role**: Manages the `UndoStack` and `RedoStack`.
- **Consumer Role**: Defines the command logic. When a user drags a shape in the Shapes Demo, the *Shapes Demo* submits a `MoveCommand` to the Shell's history.
- **Independence**: The Shell treats the command as a "Black Box" with `execute()` and `undo()` methods.

---

## 5. Rich Clipboard (The "Data Protocol")

The `ClipboardService` handles cross-window and cross-instance data exchange using a standardized JSON schema.

- **Isolation Strategy**: When a user copies, the Shell calls the active item's `export()` method. The resulting JSON is tagged with a "MIME type" (e.g., `application/vnd.scribus.story`).
- **Paste Verification**: When pasting, the Shell asks registered plugins: "Who wants to handle this MIME type?". The appropriate plugin responds and consumes the data.

---

## 6. Implementation Roadmap

### Phase 3: The Protocol Layer
- [x] Implement the **Abstract Document Model** (Item Registry).
- [x] Upgrade `SelectionService` to support multiple `AbstractItem` references.
- [x] Implement generic Marquee selection in `<scribus-app-shell>`.

### Phase 4: History & Clipboard Services
- [x] Implement the `CommandHistory` (Undo/Redo) "Black Box" manager.
- [x] Create the `ClipboardService` with cross-window `localStorage` sync.
- [ ] Refactor existing demos (Shapes, Story Editor) to use these generic shell services via the plugin API.
    - [x] Shapes Demo refactored.
    - [x] Story Editor refactoring (Undo/Redo and Clipboard).


---
Updated: 2026-04-01
Status: Refined (Isolated Consumer Focus)
