# Document Browser

**Status**: Completed (initial implementation)

## Goal

Provide a landing page where users can browse template documents and their
own documents, create new documents from templates, and open existing ones.

## Implementation

### Module structure

```
document-browser/
  index.html          — app-shell page with workspace, status bar, panels
  app/
    main.js           — DocumentBrowserPlugin: fetches store data, renders UI
  test/
    document-browser.spec.js  — 11 Playwright tests
```

### Features

- **Template listing** — fetches `GET /store/demo`, finds documents by
  locating `document.json` entries, displays cards with title, page size,
  spread/story counts, and modified date.
- **User documents listing** — same approach for `GET /store/alice`.
- **Clone dialog** — clicking "Use Template" opens a modal dialog with a
  name input (pre-filled with a slug derived from the template title).
  Submitting calls `POST /store/alice/{slug}` with `{ "from": "demo/..." }`.
  Handles 409 conflict with an inline error message.
- **Open button** — navigates to the spread editor (currently static link;
  will need per-document routing once the spread editor supports loading
  from the store).

### Dependencies

- `POST /store/{user}/{newDoc}` endpoint in `server.js` (added in prior work)
- App shell (`<scribus-app-shell>`, `shell-core.js`)
- UI components (`<scribus-button>`, `<scribus-ribbon-section>`)

### Tests

11 Playwright tests covering:
- Page loads with Ready status
- Templates section visible with at least one template
- Template cards show title and metadata (page size)
- Use Template button visible
- My Documents section visible
- User documents show Open button
- Clone dialog opens on Use Template click
- Cancel button closes dialog
- Escape key closes dialog
- Cloning creates a new document (verified by card appearing in grid)
- Duplicate clone shows conflict error

## Future work

- Per-document "Open" routing (spread editor needs store-loading support)
- Delete document action
- Rename document action
- Template preview thumbnails
- User namespace selector / multi-user support
