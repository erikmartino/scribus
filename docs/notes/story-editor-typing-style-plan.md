# [PLAN] Enhance Story Editor Typing Style Model

This plan is to upgrade the "minimal" typing style model in `docs/story-editor` into a more robust, context-aware system.

## User Review Required

> [!IMPORTANT]
> **Behavioral Change:** Formatting will no longer "stick" to the cursor when it moves. If a user clicks **Bold** and then moves the cursor elsewhere without typing, the **Bold** state will be lost as the editor adopts the style of the new location.

## Proposed Changes

### Story Editor Model

---

#### [MODIFY] [editor-state.js](../story-editor/lib/editor-state.js)
- **Automatic Style Reset**: Update `setCursor(cursor)` and `moveCursor(nextCursor, extend)` to clear `this._typingStyle = null`.
- **Selection Transitions**: When a selection is deleted (via typing over it), ensure the typing style is explicitly derived from the current cursor context before performing the insertion.

#### [MODIFY] [story-ops.js](../story-editor/lib/story-ops.js)
- **Advanced Style Resolution**: Enhance `resolveTypingStyle(story, pos, typingStyle)` to better handle boundary cases (start/end of paragraph).
- **Empty Paragraph Handling**: Ensure the typing style correctly inherits from the parent paragraph's style settings.

### Story Editor UI Integration

---

#### [MODIFY] [story-editor-plugin.js](../story-editor/lib/story-editor-plugin.js)
- **Ribbon Synchronization**: Update the `update()` loop to call `editor.getTypingStyle()` and update the state of Bold/Italic buttons in the ribbon.
- **Command Handling**: Ensure that when a user clicks a formatting button, the change is immediately reflected in the pending character style if no text is selected.

## Verification Plan

### Automated Tests
- Create `../story-editor/test/test-typing-style.js` using the Node test runner.
- **Tests to include:**
  - Verify `_typingStyle` is cleared on cursor move.
  - Verify inheritance at the start, middle, and end of runs.
  - Verify inheritance in empty paragraphs.

### Manual Verification
1. Open the Story Editor demo.
2. Place cursor in a normal paragraph.
3. Click **Bold** (verify button is active).
4. Move cursor to another paragraph (verify button turns inactive).
5. Move cursor back and type (verify text is NOT bold unless explicitly re-activated).
6. Verify that typing at the start of a "Lead" paragraph correctly uses the Lead font size/family.
