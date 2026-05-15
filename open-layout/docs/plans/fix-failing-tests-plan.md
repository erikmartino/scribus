# Fix Failing Tests and Properties Panel Regression

Tests are failing due to recent changes in sample data (paragraph count) and a bug in the App Shell's property panel rendering (incorrect use of `innerHTML` on a `DocumentFragment`).

## Proposed Changes

### App Shell

#### [MODIFY] [shell-core.js](file:///home/martino/git/scribus/open-layout/app-shell/lib/shell-core.js)
- Fix `_renderPropertiesPanel` to correctly append the empty state message to the `DocumentFragment` instead of using `innerHTML`.

### Document Inspector

#### [MODIFY] [document-store.spec.js](file:///home/martino/git/scribus/open-layout/document-store/test/document-store.spec.js)
- Update paragraph count expectation from `3 paragraph(s)` to `4 paragraph(s)`.

## Verification Plan

### Automated Tests
- Run the failing Playwright tests:
  ```bash
  CI=true timeout 2m npx playwright test app-shell/test/properties-panel.spec.js app-shell/test/shared-properties.spec.js document-store/test/document-store.spec.js
  ```
