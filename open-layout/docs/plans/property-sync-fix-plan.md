# Fix Property Synchronization in App-Shell

The Properties panel does not always update correctly when switching selection between shapes. This is due to limitations in the `_reconcileDOM` logic in `shell-core.js`, which fails to correctly identify elements (like property groups and rows) and doesn't sync text content for matched elements.

## User Review Required

> [!IMPORTANT]
> The fix involves changing how elements are matched during DOM reconciliation. This might affect other parts of the UI that rely on this reconciliation (like the ribbon). I will ensure that existing identities are preserved or enhanced.

## Proposed Changes

### App Shell

#### [MODIFY] [shell-core.js](file:///home/martino/git/scribus/open-layout/app-shell/lib/shell-core.js)
- Update `_reconcileDOM` to include `data-property-key` and property group headings in the identity calculation.
- Update `_updateElement` to sync `textContent` for elements without children.
- Ensure attributes that were removed are also synced (by removing them from the target).

### Property Descriptors

#### [MODIFY] [property-descriptors.js](file:///home/martino/git/scribus/open-layout/app-shell/lib/property-descriptors.js)
- Ensure property rows and groups have consistent markers that can be used for identification in the shell.

## Verification Plan

### Automated Tests
- Run the reproduction test `app-shell/test/repro-sync.spec.js`.
- Run all existing tests to ensure no regressions: `CI=true npx playwright test`.

### Manual Verification
- Verify in the browser that switching from a text frame to an image frame (or background) correctly updates the property panel headings and labels.
