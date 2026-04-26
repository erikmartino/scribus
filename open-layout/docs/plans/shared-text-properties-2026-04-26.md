# Shared Text Properties Implementation Plan (2026-04-26) [COMPLETED]

Implement the properties tab in the Story Editor using the new structured data contract, and reuse it in the Spread Editor.

## Goals
- Migrating Story Editor to the new Property Descriptor API. [DONE]
- Reusing the text property logic in Spread Editor. [DONE]
- Ensuring bidirectional sync for both. [DONE]
- **UI Stability & Flicker Prevention**. [DONE]

## Proposed Changes

### App Shell Library
- `app-shell/lib/text-property-descriptors.js`: Reusable utility for character/paragraph styles. [DONE]
- `app-shell/lib/shell-core.js`: Implemented surgical DOM reconciliation (`_reconcileDOM`) to update ribbon and panels in-place. [DONE]

### UI Components
- `ui-components/lib/ui-elements.js`: Refactored `ScribusInput` to use incremental Shadow DOM updates (v.s. innerHTML) to preserve focus and mouse capture during reconciliation. [DONE]

### Story Editor
- `story-editor/lib/story-editor-plugin.js`: Migrate to `getPanelDescriptors`. [DONE]

### Spread Editor
- `spread-editor/app/spread-editor-app.js`: Implement `getPanelDescriptors` for both boxes and text editing. [DONE]

## Verification
- Unit tests for new descriptors: `npm test app-shell/test/test-text-property-descriptors.js` [PASSED]
- Playwright E2E tests for stability: `npx playwright test app-shell/test/sidebar-typing.spec.js` [PASSED]
- Playwright E2E tests for interaction: `npx playwright test app-shell/test/ribbon-interaction.spec.js` [PASSED]
