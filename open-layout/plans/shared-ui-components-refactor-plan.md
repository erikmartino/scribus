# Shared UI Components Refactor Plan

**Created:** 2026-04-18
**Status:** Completed

## Motivation

Inline CSS for status bars, dialogs, info cards, and panel headers was
duplicated across `document-browser`, `spread-editor`, and `story-editor`.
Extracting these into reusable web components and shared utility classes
keeps each demo lean and ensures visual consistency.

## Components created

### 1. `<scribus-status-bar>`

Located in `ui-components/lib/status-bar.js`.

- Shadow DOM component with encapsulated CSS.
- Attributes: `type` (`ok` | `error` | none for default).
- Default slot for text content.
- Positioned absolute bottom-left with translucent backdrop.
- API: `setText(msg, type)` convenience method.

### 2. `<scribus-dialog>`

Located in `ui-components/lib/dialog.js`.

- Shadow DOM component with slots:
  - default slot: dialog body content
  - `actions` slot: button row (flex, right-aligned)
- Attributes: `open` (boolean), `heading` (optional title).
- Renders fullscreen fixed overlay + centered card on open.
- Methods: `show()`, `close()`.
- Events: `close` (dispatched on backdrop click or Escape).
- `::slotted()` rules style light-DOM labels, inputs, and buttons.

### 3. Shared utility classes in `shell.css`

- `.info-card` — glass panel with backdrop blur, border, shadow.
- `.panel-header` — accent-colored heading for side panels.

## Additional cleanup

- Removed redundant `body` rules from `spread-editor` and `story-editor`
  (already covered by `shell.css` global reset and body styles).
- Removed unused `--pasteboard-dark` custom property from `spread-editor`.
- Removed single-use `--paper`, `--paper-border`, `--workspace-bg` custom
  properties; inlined values directly in `#svg-container` rules.
- Removed redundant `[data-mode="object"] #svg-container { cursor: default }`
  rule (duplicated the default).
- Replaced inline `style` attributes on panel titles with `.panel-header` class.
- Fixed `story-editor` paths from absolute (`/app-shell/...`) to relative
  (`../app-shell/...`) with a `<base href="/story-editor/">` tag to support
  serving from `/store/.../edit` routes.
- Added `import '../ui-components/index.js'` to `story-editor` (was missing).

## Files modified

| File | Change |
|------|--------|
| `ui-components/lib/status-bar.js` | New — `<scribus-status-bar>` |
| `ui-components/lib/dialog.js` | New — `<scribus-dialog>` |
| `ui-components/index.js` | Export new components |
| `app-shell/css/shell.css` | Add `.info-card`, `.panel-header` utilities |
| `document-browser/index.html` | Remove ~100 lines inline CSS (dialog, status bar) |
| `document-browser/app/main.js` | Use `<scribus-dialog>` instead of manual DOM |
| `document-browser/test/document-browser.spec.js` | Update selectors for new components |
| `spread-editor/index.html` | Remove status-bar, info-card, redundant body/cursor CSS |
| `spread-editor/app/spread-editor-app.js` | Use `setText()` API on status bar |
| `story-editor/index.html` | Fix paths, remove info-card/body CSS, add `<base>` tag |
| `app-shell/index.html` | Use `.panel-header` class |
| `app-shell/test/shared-components.spec.js` | New Playwright tests |

## Completed work

- [x] Create plan
- [x] Implement `<scribus-status-bar>`
- [x] Implement `<scribus-dialog>`
- [x] Add `.info-card` and `.panel-header` to `shell.css`
- [x] Refactor all demo pages
- [x] Refactor `document-browser/app/main.js`
- [x] Update existing document-browser tests
- [x] Write and run Playwright tests (all passing)
- [x] Remove redundant CSS (body rules, unused custom properties)
- [x] Fix story-editor absolute paths to relative
