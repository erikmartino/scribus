# Shared Text Properties Implementation Plan (2026-04-26)

Implement the properties tab in the Story Editor using the new structured data contract, and reuse it in the Spread Editor.

## Goals
- Migrating Story Editor to the new Property Descriptor API.
- Reusing the text property logic in Spread Editor.
- Ensuring bidirectional sync for both.

## Proposed Changes

### App Shell Library
- `app-shell/lib/text-property-descriptors.js`: Reusable utility for character/paragraph styles.

### Story Editor
- `story-editor/lib/story-editor-plugin.js`: Migrate to `getPanelDescriptors`.

### Spread Editor
- `spread-editor/app/spread-editor-app.js`: Implement `getPanelDescriptors` for both boxes and text editing.

## Verification
- Unit tests for new descriptors.
- Playwright E2E tests for both editors.
