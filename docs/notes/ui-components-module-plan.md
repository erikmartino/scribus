# Plan: UI Components Module Migration

Create a dedicated sibling module for reusable UI components, moving them out of the App Shell to improve modularity and provide a standalone component gallery.

## 1. Directory Structure
Create `docs/ui-components/`:
- `lib/`: Component source files.
- `index.js`: Module entry point (exports).
- `index.html`: Component gallery/documentation.

## 2. Migration Phase
Move the following from `docs/app-shell/lib/components/` to `docs/ui-components/lib/`:
- [ ] `ui-elements.js` (ScribusButton, ScribusInput)
- [ ] `font-selector.js` (ScribusFontSelector)

*Note: `app-shell-element.js` and `command-palette.js` may remain in `app-shell` as they are core orchestration components, or move if they are intended to be reused elsewhere.*

## 3. Module Entry Point
Create `docs/ui-components/index.js`:
- [ ] Export `ScribusButton`, `ScribusInput`, `ScribusFontSelector`.
- [ ] Registration of custom elements.

## 4. Component Gallery
Create `docs/ui-components/index.html`:
- [ ] List all components with live previews.
- [ ] Basic usage examples.

## 5. Integration Updates
Update imports in the following files:
- [ ] `docs/app-shell/lib/shell-core.js`
- [ ] `docs/app-shell/index.html`
- [ ] `docs/story-editor/index.html`
- [ ] `docs/spread-editor/index.html` (if applicable)

## 6. Verification
- [ ] Open `docs/ui-components/index.html` in browser and verify all components render.
- [ ] Verify `App Shell` and `Story Editor` still function correctly with migrated components.
- [ ] Check browser console for import/network errors.
