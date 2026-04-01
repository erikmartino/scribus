# Plan: Story Editor App Shell Integration Update

Update the `story-editor` to fully utilize the latest `app-shell` architecture (Web Components, Generic History, Rich Clipboard) and add comprehensive testing.

## 1. Unit Tests (New)
Create `docs/story-editor/test/test-story-editor-plugin.js` to verify:
- [ ] `StoryEditorPlugin` correctly registers commands with the shell.
- [ ] `submitAction` correctly wraps state changes and pushes to `shell.history`.
- [ ] `handlePaste` correctly handles `story` data type from the shell's `paste-received` event.
- [ ] Multi-character typing grouping in `submitAction`.

## 2. Code Updates
Refine `docs/story-editor/lib/story-editor-plugin.js`:
- [ ] Ensure `handlePaste` properly merges or replaces content based on selection.
- [ ] Ensure `getRibbonSections` and `getPanelContent` use the latest `scribus-button` and `scribus-input` via `shell.ui`.
- [ ] Add `isEnabled` and `isActive` checks for ribbon buttons (bold/italic).

## 3. Playwright Integration Tests
Update/Fix `docs/app-shell/test/story-editor.spec.js`:
- [ ] **Undo/Redo**: Verify that typing and styling can be undone via both keyboard (`Ctrl+Z`) and the ribbon's Undo button.
- [ ] **Copy/Paste**: Verify that copying text from one part of the editor and pasting it elsewhere works and is undoable.
- [ ] **Rich Clipboard**: (Optional) Verify that style (Bold/Italic) is preserved across copy/paste if possible (current implementation might lose styling if it just uses `InnerText`).

## 4. UI Polish
- [ ] Update `docs/story-editor/index.html` to align with the modern dark-mode aesthetic of the app-shell.
- [ ] Ensure the font selector in the ribbon is correctly populated and functional.

## Verification
1. Run unit tests: `node --test test/*.js` from `docs/story-editor`.
2. Run playwright tests: `npx playwright test app-shell/test/story-editor.spec.js`.
